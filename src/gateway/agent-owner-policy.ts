import type { OpenClawConfig } from "../config/config.js";
import type { GatewayOwnerContext } from "./owner-context.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveGatewayMultiUserMode } from "./multi-user-mode.js";
import { hasGatewayDelegatedAccess } from "./delegation-policy.js";
import { ErrorCodes, errorShape, type ErrorShape } from "./protocol/index.js";

function normalizeToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveAgentOwnerUserId(params: {
  cfg: OpenClawConfig;
  agentId: string;
}): string | undefined {
  const id = normalizeAgentId(params.agentId);
  const entries = Array.isArray(params.cfg.agents?.list) ? params.cfg.agents?.list : [];
  const entry = entries?.find((candidate) => normalizeAgentId(candidate.id) === id);
  return normalizeToken(entry?.ownerUserId);
}

function ownerMismatchError(params: {
  agentId: string;
  ownerUserId: string;
  agentOwnerUserId?: string;
}): ErrorShape {
  return errorShape(ErrorCodes.INVALID_REQUEST, "agent owner mismatch", {
    details: {
      reasonCode: "OWNER_MISMATCH",
      agentId: params.agentId,
      ownerUserId: params.ownerUserId,
      agentOwnerUserId: params.agentOwnerUserId ?? null,
    },
  });
}

export function assertAgentOwnership(params: {
  cfg: OpenClawConfig;
  owner?: GatewayOwnerContext | null;
  agentId: string;
}): { ok: true } | { ok: false; error: ErrorShape } {
  const owner = params.owner;
  if (!owner || owner.role === "admin") {
    return { ok: true };
  }
  const mode = resolveGatewayMultiUserMode(params.cfg);
  if (mode === "off") {
    return { ok: true };
  }
  const agentOwnerUserId = resolveAgentOwnerUserId({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  if (!agentOwnerUserId) {
    if (mode !== "strict") {
      return { ok: true };
    }
    return {
      ok: false,
      error: ownerMismatchError({
        agentId: params.agentId,
        ownerUserId: owner.userId,
        agentOwnerUserId,
      }),
    };
  }
  if (agentOwnerUserId !== owner.userId) {
    if (
      hasGatewayDelegatedAccess({
        cfg: params.cfg,
        fromUserId: owner.userId,
        ownerUserId: agentOwnerUserId,
        resource: "agents",
      })
    ) {
      return { ok: true };
    }
    return {
      ok: false,
      error: ownerMismatchError({
        agentId: params.agentId,
        ownerUserId: owner.userId,
        agentOwnerUserId,
      }),
    };
  }
  return { ok: true };
}
