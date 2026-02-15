import { randomUUID } from "node:crypto";
import type { MsgContext } from "../templating.js";
import type { CommandContext } from "./commands-types.js";
import { recordGatewayAuthzDenyEvent } from "../../gateway/authz-denied-events.js";

const ADMIN_SCOPE = "operator.admin";

type CommandDenyReasonCode = "ROLE_FORBIDDEN" | "SCOPE_MISSING" | "UNKNOWN_SENDER" | "POLICY_DENY";

function normalizeToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeScopes(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
    .filter((scope) => scope.length > 0);
}

function normalizeOwnerRole(raw: unknown): "admin" | "user" | "node" | "service" | null {
  if (typeof raw !== "string") {
    return null;
  }
  const lowered = raw.trim().toLowerCase();
  if (lowered === "admin" || lowered === "user" || lowered === "node" || lowered === "service") {
    return lowered;
  }
  return null;
}

export function recordCommandAuthzDeny(params: {
  ctx: MsgContext;
  command: Pick<CommandContext, "channel" | "senderId">;
  method: string;
  reasonCode: CommandDenyReasonCode;
  message: string;
  errorCode?: string;
}) {
  const scopes = normalizeScopes(params.ctx.GatewayClientScopes);
  const userId = normalizeToken(params.ctx.GatewayOwnerUserId) ?? null;
  const userAlias = normalizeToken(params.ctx.GatewayOwnerAlias) ?? null;
  const principalId = normalizeToken(params.ctx.GatewayOwnerPrincipalId) ?? null;
  const ownerRole = normalizeOwnerRole(params.ctx.GatewayOwnerRole);
  const hasGatewayIdentity = Boolean(userId || principalId || ownerRole || scopes.length > 0);
  const actorRole = !hasGatewayIdentity
    ? null
    : ownerRole ??
      // Do not infer admin actor role from scope alone when principal role is unresolved.
      (scopes.includes(ADMIN_SCOPE) ? null : "user");
  const sourceRole = hasGatewayIdentity ? "operator" : null;
  const clientId = normalizeToken(params.ctx.GatewayClientId) ?? null;
  const clientMode =
    normalizeToken(params.ctx.GatewayClientMode) ??
    normalizeToken(params.ctx.Surface) ??
    normalizeToken(params.ctx.Provider) ??
    normalizeToken(params.command.channel) ??
    null;
  const sourceIp = normalizeToken(params.ctx.GatewaySourceIp) ?? null;
  const requestId = `${params.method}:${randomUUID()}`;

  recordGatewayAuthzDenyEvent({
    ts: Date.now(),
    requestId,
    method: params.method,
    reasonCode: params.reasonCode,
    errorCode: params.errorCode ?? "INVALID_REQUEST",
    errorMessage: params.message,
    userId,
    userAlias,
    principalId,
    actorRole,
    sourceRole,
    clientId,
    clientMode,
    sourceIp,
  });
}
