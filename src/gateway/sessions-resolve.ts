import type { OpenClawConfig } from "../config/config.js";
import { loadSessionStore } from "../config/sessions.js";
import { parseSessionLabel } from "../sessions/session-label.js";
import { hasGatewayDelegatedAccess } from "./delegation-policy.js";
import {
  ErrorCodes,
  type ErrorShape,
  errorShape,
  type SessionsResolveParams,
} from "./protocol/index.js";
import {
  listSessionsFromStore,
  loadCombinedSessionStoreForGateway,
  resolveGatewaySessionStoreTarget,
} from "./session-utils.js";

export type SessionsResolveResult = { ok: true; key: string } | { ok: false; error: ErrorShape };

function canResolveSessionForOwner(params: {
  cfg: OpenClawConfig;
  requesterUserId: string;
  sessionOwnerUserId?: string;
}): boolean {
  const sessionOwnerUserId =
    typeof params.sessionOwnerUserId === "string" ? params.sessionOwnerUserId.trim() : "";
  if (!sessionOwnerUserId) {
    return false;
  }
  if (sessionOwnerUserId === params.requesterUserId) {
    return true;
  }
  return hasGatewayDelegatedAccess({
    cfg: params.cfg,
    fromUserId: params.requesterUserId,
    ownerUserId: sessionOwnerUserId,
    resource: "sessions",
  });
}

export function resolveSessionKeyFromResolveParams(params: {
  cfg: OpenClawConfig;
  p: SessionsResolveParams;
  ownerUserId?: string;
}): SessionsResolveResult {
  const { cfg, p } = params;
  const ownerUserId = typeof params.ownerUserId === "string" ? params.ownerUserId.trim() : "";

  const key = typeof p.key === "string" ? p.key.trim() : "";
  const hasKey = key.length > 0;
  const sessionId = typeof p.sessionId === "string" ? p.sessionId.trim() : "";
  const hasSessionId = sessionId.length > 0;
  const hasLabel = typeof p.label === "string" && p.label.trim().length > 0;
  const selectionCount = [hasKey, hasSessionId, hasLabel].filter(Boolean).length;
  if (selectionCount > 1) {
    return {
      ok: false,
      error: errorShape(
        ErrorCodes.INVALID_REQUEST,
        "Provide either key, sessionId, or label (not multiple)",
      ),
    };
  }
  if (selectionCount === 0) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, "Either key, sessionId, or label is required"),
    };
  }

  if (hasKey) {
    const target = resolveGatewaySessionStoreTarget({ cfg, key, ownerUserId });
    const store = loadSessionStore(target.storePath);
    const existingKey = target.storeKeys.find((candidate) => store[candidate]);
    if (!existingKey) {
      return {
        ok: false,
        error: errorShape(ErrorCodes.INVALID_REQUEST, `No session found: ${key}`),
      };
    }
    if (ownerUserId) {
      const ownedEntry = store[existingKey];
      if (
        !canResolveSessionForOwner({
          cfg,
          requesterUserId: ownerUserId,
          sessionOwnerUserId: ownedEntry?.ownerUserId,
        })
      ) {
        return {
          ok: false,
          error: errorShape(ErrorCodes.INVALID_REQUEST, `No session found: ${key}`),
        };
      }
    }
    return { ok: true, key: target.canonicalKey };
  }

  if (hasSessionId) {
    const { storePath, store } = loadCombinedSessionStoreForGateway(cfg, { ownerUserId });
    const list = listSessionsFromStore({
      cfg,
      storePath,
      store,
      opts: {
        includeGlobal: p.includeGlobal === true,
        includeUnknown: p.includeUnknown === true,
        spawnedBy: p.spawnedBy,
        agentId: p.agentId,
        search: sessionId,
        limit: 8,
      },
    });
    const matches = list.sessions
      .filter((session) => session.sessionId === sessionId || session.key === sessionId)
      .filter((session) => {
        if (!ownerUserId) {
          return true;
        }
        return canResolveSessionForOwner({
          cfg,
          requesterUserId: ownerUserId,
          sessionOwnerUserId: session.ownerUserId,
        });
      });
    if (matches.length === 0) {
      return {
        ok: false,
        error: errorShape(ErrorCodes.INVALID_REQUEST, `No session found: ${sessionId}`),
      };
    }
    if (matches.length > 1) {
      const keys = matches.map((session) => session.key).join(", ");
      return {
        ok: false,
        error: errorShape(
          ErrorCodes.INVALID_REQUEST,
          `Multiple sessions found for sessionId: ${sessionId} (${keys})`,
        ),
      };
    }
    return { ok: true, key: String(matches[0]?.key ?? "") };
  }

  const parsedLabel = parseSessionLabel(p.label);
  if (!parsedLabel.ok) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, parsedLabel.error),
    };
  }

  const { storePath, store } = loadCombinedSessionStoreForGateway(cfg, { ownerUserId });
  const list = listSessionsFromStore({
    cfg,
    storePath,
    store,
    opts: {
      includeGlobal: p.includeGlobal === true,
      includeUnknown: p.includeUnknown === true,
      label: parsedLabel.label,
      agentId: p.agentId,
      spawnedBy: p.spawnedBy,
      limit: 2,
    },
  });
  const ownerFilteredSessions = list.sessions.filter((session) => {
    if (!ownerUserId) {
      return true;
    }
    return canResolveSessionForOwner({
      cfg,
      requesterUserId: ownerUserId,
      sessionOwnerUserId: session.ownerUserId,
    });
  });
  if (ownerFilteredSessions.length === 0) {
    return {
      ok: false,
      error: errorShape(
        ErrorCodes.INVALID_REQUEST,
        `No session found with label: ${parsedLabel.label}`,
      ),
    };
  }
  if (ownerFilteredSessions.length > 1) {
    const keys = ownerFilteredSessions.map((s) => s.key).join(", ");
    return {
      ok: false,
      error: errorShape(
        ErrorCodes.INVALID_REQUEST,
        `Multiple sessions found with label: ${parsedLabel.label} (${keys})`,
      ),
    };
  }

  return { ok: true, key: String(ownerFilteredSessions[0]?.key ?? "") };
}
