import type { GatewayClient } from "./server-methods/types.js";
import { recordGatewayAuthzDenyEvent } from "./authz-denied-events.js";
import { resolveConnectOwnerContext, type GatewayOwnerContext } from "./owner-context.js";
import {
  classifyGatewayMethodAccess,
  OPERATOR_ADMIN_SCOPE,
  OPERATOR_APPROVALS_SCOPE,
  OPERATOR_PAIRING_SCOPE,
  OPERATOR_READ_SCOPE,
  OPERATOR_WRITE_SCOPE,
} from "./operator-scopes.js";
import { ErrorCodes, errorShape, type ErrorShape } from "./protocol/index.js";

const GatewayDenyReasonCodes = {
  ROLE_FORBIDDEN: "ROLE_FORBIDDEN",
  SCOPE_MISSING: "SCOPE_MISSING",
  UNKNOWN_SENDER: "UNKNOWN_SENDER",
  POLICY_DENY: "POLICY_DENY",
} as const;

export type GatewayDenyReasonCode =
  (typeof GatewayDenyReasonCodes)[keyof typeof GatewayDenyReasonCodes];

export type GatewayAuthzDecision =
  | {
      allow: true;
      owner: GatewayOwnerContext;
    }
  | {
      allow: false;
      owner: GatewayOwnerContext | null;
      reasonCode: GatewayDenyReasonCode;
      error: ErrorShape;
    };

type GatewayAuditLogger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
};

function withReasonDetails(
  reasonCode: GatewayDenyReasonCode,
  details?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    reasonCode,
    ...(details ?? {}),
  };
}

function deny(params: {
  owner: GatewayOwnerContext | null;
  reasonCode: GatewayDenyReasonCode;
  message: string;
  details?: Record<string, unknown>;
}): GatewayAuthzDecision {
  return {
    allow: false,
    owner: params.owner,
    reasonCode: params.reasonCode,
    error: errorShape(ErrorCodes.INVALID_REQUEST, params.message, {
      details: withReasonDetails(params.reasonCode, params.details),
    }),
  };
}

function resolveOwnerContext(client: GatewayClient | null): GatewayOwnerContext | null {
  if (!client?.connect) {
    return null;
  }
  return (
    client.owner ?? resolveConnectOwnerContext({ connect: client.connect, connId: client.connId })
  );
}

export function authorizeGatewayMethod(params: {
  method: string;
  client: GatewayClient | null;
}): GatewayAuthzDecision {
  const owner = resolveOwnerContext(params.client);
  if (!owner) {
    return deny({
      owner: null,
      reasonCode: GatewayDenyReasonCodes.UNKNOWN_SENDER,
      message: "unknown sender identity",
    });
  }
  const role = owner.sourceRole;
  const scopes = owner.scopes;
  const accessClass = classifyGatewayMethodAccess(params.method);
  const hasAdminScope = scopes.includes(OPERATOR_ADMIN_SCOPE);
  const isAdminPrincipal = owner.role === "admin";
  if (accessClass === "node-role") {
    if (role === "node") {
      return { allow: true, owner };
    }
    return deny({
      owner,
      reasonCode: GatewayDenyReasonCodes.ROLE_FORBIDDEN,
      message: `unauthorized role: ${role}`,
      details: { role },
    });
  }
  if (role === "node") {
    return deny({
      owner,
      reasonCode: GatewayDenyReasonCodes.ROLE_FORBIDDEN,
      message: `unauthorized role: ${role}`,
      details: { role },
    });
  }
  if (role !== "operator") {
    return deny({
      owner,
      reasonCode: GatewayDenyReasonCodes.ROLE_FORBIDDEN,
      message: `unauthorized role: ${role}`,
      details: { role },
    });
  }
  if (hasAdminScope && isAdminPrincipal) {
    return { allow: true, owner };
  }
  if (accessClass === "approval" && !scopes.includes(OPERATOR_APPROVALS_SCOPE)) {
    return deny({
      owner,
      reasonCode: GatewayDenyReasonCodes.SCOPE_MISSING,
      message: "missing scope: operator.approvals",
      details: { requiredScope: OPERATOR_APPROVALS_SCOPE },
    });
  }
  if (accessClass === "pairing" && !scopes.includes(OPERATOR_PAIRING_SCOPE)) {
    return deny({
      owner,
      reasonCode: GatewayDenyReasonCodes.SCOPE_MISSING,
      message: "missing scope: operator.pairing",
      details: { requiredScope: OPERATOR_PAIRING_SCOPE },
    });
  }
  if (accessClass === "read" && !(scopes.includes(OPERATOR_READ_SCOPE) || scopes.includes(OPERATOR_WRITE_SCOPE))) {
    return deny({
      owner,
      reasonCode: GatewayDenyReasonCodes.SCOPE_MISSING,
      message: "missing scope: operator.read",
      details: { requiredScope: OPERATOR_READ_SCOPE },
    });
  }
  if (accessClass === "write" && !scopes.includes(OPERATOR_WRITE_SCOPE)) {
    return deny({
      owner,
      reasonCode: GatewayDenyReasonCodes.SCOPE_MISSING,
      message: "missing scope: operator.write",
      details: { requiredScope: OPERATOR_WRITE_SCOPE },
    });
  }
  if (accessClass === "approval") {
    return { allow: true, owner };
  }
  if (accessClass === "pairing") {
    return { allow: true, owner };
  }
  if (accessClass === "read") {
    return { allow: true, owner };
  }
  if (accessClass === "write") {
    return { allow: true, owner };
  }
  if (accessClass === "admin") {
    if (hasAdminScope && !isAdminPrincipal) {
      return deny({
        owner,
        reasonCode: GatewayDenyReasonCodes.ROLE_FORBIDDEN,
        message: "admin scope requires admin principal role",
        details: { requiredRole: "admin", principalRole: owner.role },
      });
    }
    return deny({
      owner,
      reasonCode: GatewayDenyReasonCodes.SCOPE_MISSING,
      message: "missing scope: operator.admin",
      details: { requiredScope: OPERATOR_ADMIN_SCOPE },
    });
  }
  return deny({
    owner,
    reasonCode: GatewayDenyReasonCodes.SCOPE_MISSING,
    message: "missing scope: operator.admin",
    details: { requiredScope: OPERATOR_ADMIN_SCOPE },
  });
}

export function auditGatewayAuthorization(params: {
  logger: GatewayAuditLogger;
  method: string;
  requestId: string;
  decision: GatewayAuthzDecision;
  client: GatewayClient | null;
}): void {
  const ownerMeta = params.decision.owner
    ? {
        userId: params.decision.owner.userId,
        userAlias: params.decision.owner.alias ?? null,
        principalId: params.decision.owner.principalId,
        actorRole: params.decision.owner.role,
        sourceRole: params.decision.owner.sourceRole,
      }
    : {
        userId: null,
        userAlias: null,
        principalId: null,
        actorRole: null,
        sourceRole: null,
      };
  if (params.decision.allow) {
    params.logger.debug?.("gateway authz allow", {
      requestId: params.requestId,
      method: params.method,
      ...ownerMeta,
      result: "allow",
    });
    return;
  }
  params.logger.warn("gateway authz deny", {
    requestId: params.requestId,
    method: params.method,
    ...ownerMeta,
    result: "deny",
    reasonCode: params.decision.reasonCode,
    errorCode: params.decision.error.code,
    errorMessage: params.decision.error.message,
  });
  const clientMeta = params.client?.connect?.client;
  recordGatewayAuthzDenyEvent({
    ts: Date.now(),
    requestId: params.requestId,
    method: params.method,
    reasonCode: params.decision.reasonCode,
    errorCode: params.decision.error.code,
    errorMessage: params.decision.error.message,
    userId: ownerMeta.userId,
    userAlias: ownerMeta.userAlias,
    principalId: ownerMeta.principalId,
    actorRole: ownerMeta.actorRole,
    sourceRole: ownerMeta.sourceRole,
    clientId: typeof clientMeta?.id === "string" ? clientMeta.id : null,
    clientMode: typeof clientMeta?.mode === "string" ? clientMeta.mode : null,
    sourceIp: typeof params.client?.clientIp === "string" ? params.client.clientIp : null,
  });
}
