import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import type { GatewayOwnerContext } from "./owner-context.js";
import { hasGatewayDelegatedAccess } from "./delegation-policy.js";
import { isGatewayOwnerEnforcementEnabled, isGatewayStrictOwnerMode } from "./multi-user-mode.js";
import { ErrorCodes, errorShape, type ErrorShape } from "./protocol/index.js";

const OWNER_MISMATCH = "OWNER_MISMATCH";
function normalizeOwnerUserId(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ownerError(params: {
  message: string;
  reasonCode: typeof OWNER_MISMATCH;
  details?: Record<string, unknown>;
}): ErrorShape {
  return errorShape(ErrorCodes.INVALID_REQUEST, params.message, {
    details: {
      reasonCode: params.reasonCode,
      ...params.details,
    },
  });
}

export function isOwnerRestrictedPrincipal(
  owner: GatewayOwnerContext | null | undefined,
  cfg?: OpenClawConfig,
): boolean {
  return isGatewayOwnerEnforcementEnabled({ owner, cfg });
}

export function sessionOwnedByUser(entry: SessionEntry | undefined, ownerUserId: string): boolean {
  const sessionOwner = normalizeOwnerUserId(entry?.ownerUserId);
  return sessionOwner === ownerUserId;
}

export function stampSessionOwner(params: {
  entry: SessionEntry;
  owner: GatewayOwnerContext | null | undefined;
}): SessionEntry {
  const owner = params.owner;
  if (!owner || owner.role === "admin") {
    return params.entry;
  }
  const existingOwnerUserId = normalizeOwnerUserId(params.entry.ownerUserId);
  if (existingOwnerUserId) {
    // Never overwrite an existing owner binding during delegated access.
    if (existingOwnerUserId !== owner.userId) {
      return params.entry;
    }
    // Backfill missing ownerPrincipalId for same-owner sessions.
    const existingOwnerPrincipalId = normalizeOwnerUserId(params.entry.ownerPrincipalId);
    if (existingOwnerPrincipalId === owner.principalId) {
      return params.entry;
    }
    return {
      ...params.entry,
      ownerPrincipalId: owner.principalId,
    };
  }
  if (
    params.entry.ownerUserId === owner.userId &&
    params.entry.ownerPrincipalId === owner.principalId
  ) {
    return params.entry;
  }
  return {
    ...params.entry,
    ownerUserId: owner.userId,
    ownerPrincipalId: owner.principalId,
  };
}

export function assertSessionAccess(params: {
  owner: GatewayOwnerContext | null | undefined;
  entry: SessionEntry | undefined;
  sessionKey: string;
  cfg?: OpenClawConfig;
}): { ok: true } | { ok: false; error: ErrorShape } {
  const { owner, entry, sessionKey, cfg } = params;
  if (!owner) {
    // Gateway runtime always sets owner context via centralized authz.
    // Unit tests and direct handler invocations may omit it.
    return { ok: true };
  }
  if (!isOwnerRestrictedPrincipal(owner, cfg)) {
    return { ok: true };
  }
  if (!entry) {
    return { ok: true };
  }
  const currentOwner = normalizeOwnerUserId(entry.ownerUserId);
  if (!currentOwner) {
    if (!isGatewayStrictOwnerMode(cfg)) {
      return { ok: true };
    }
    return {
      ok: false,
      error: ownerError({
        message: `session owner missing for key: ${sessionKey}`,
        reasonCode: OWNER_MISMATCH,
        details: { sessionKey, ownerUserId: owner.userId, sessionOwnerUserId: null },
      }),
    };
  }
  if (currentOwner !== owner.userId) {
    if (
      hasGatewayDelegatedAccess({
        cfg,
        fromUserId: owner.userId,
        ownerUserId: currentOwner,
        resource: "sessions",
      })
    ) {
      return { ok: true };
    }
    return {
      ok: false,
      error: ownerError({
        message: `session owner mismatch for key: ${sessionKey}`,
        reasonCode: OWNER_MISMATCH,
        details: { sessionKey, ownerUserId: owner.userId, sessionOwnerUserId: currentOwner },
      }),
    };
  }
  return { ok: true };
}
