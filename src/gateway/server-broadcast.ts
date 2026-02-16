import type { GatewayMultiUserMode } from "./multi-user-mode.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { MAX_BUFFERED_BYTES } from "./server-constants.js";
import { logWs, summarizeAgentEventForWsLog } from "./ws-log.js";

const ADMIN_SCOPE = "operator.admin";
const APPROVALS_SCOPE = "operator.approvals";
const PAIRING_SCOPE = "operator.pairing";
const OWNER_SCOPED_EVENTS = new Set(["chat", "agent"]);
const ADMIN_ONLY_EVENTS = new Set([
  "presence",
  "heartbeat",
  "cron",
  "talk.mode",
  "voicewake.changed",
]);
const OWNER_CACHE_TTL_MS = 5_000;

const EVENT_SCOPE_GUARDS: Record<string, string[]> = {
  "exec.approval.requested": [APPROVALS_SCOPE],
  "exec.approval.resolved": [APPROVALS_SCOPE],
  "device.pair.requested": [PAIRING_SCOPE],
  "device.pair.resolved": [PAIRING_SCOPE],
  "node.pair.requested": [PAIRING_SCOPE],
  "node.pair.resolved": [PAIRING_SCOPE],
};

function normalizeToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isAdminClient(
  client: GatewayWsClient,
  params: { requireResolvedPrincipal: boolean },
): boolean {
  if (client.owner) {
    return client.owner.role === "admin";
  }
  if (params.requireResolvedPrincipal) {
    return false;
  }
  const role = client.connect.role ?? "operator";
  if (role !== "operator") {
    return false;
  }
  const scopes = Array.isArray(client.connect.scopes) ? client.connect.scopes : [];
  return scopes.includes(ADMIN_SCOPE);
}

function hasEventScope(
  client: GatewayWsClient,
  event: string,
  params: { requireResolvedPrincipal: boolean },
): boolean {
  if (params.requireResolvedPrincipal && ADMIN_ONLY_EVENTS.has(event)) {
    return isAdminClient(client, params);
  }
  const required = EVENT_SCOPE_GUARDS[event];
  if (!required) {
    return true;
  }
  const role = client.connect.role ?? "operator";
  if (role !== "operator") {
    return false;
  }
  if (isAdminClient(client, params)) {
    return true;
  }
  const scopes = Array.isArray(client.connect.scopes) ? client.connect.scopes : [];
  return required.some((scope) => scopes.includes(scope));
}

function getSessionKeyFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  return normalizeToken((payload as { sessionKey?: unknown }).sessionKey);
}

function normalizeMultiUserMode(raw: unknown): GatewayMultiUserMode | undefined {
  if (raw === "off" || raw === "compat" || raw === "strict") {
    return raw;
  }
  return undefined;
}

export function createGatewayBroadcaster(params: {
  clients: Set<GatewayWsClient>;
  resolveOwnerUserIdForSessionKey?: (sessionKey: string) => string | undefined;
  multiUserMode?: GatewayMultiUserMode;
  getMultiUserMode?: () => GatewayMultiUserMode;
  canAccessOwnerScopedEvent?: (params: {
    event: string;
    sessionKey?: string;
    viewerUserId: string;
    ownerUserId: string;
  }) => boolean;
}) {
  let seq = 0;
  const staticMultiUserMode = params.multiUserMode ?? "strict";
  const resolveActiveMultiUserMode = (): GatewayMultiUserMode => {
    try {
      return normalizeMultiUserMode(params.getMultiUserMode?.()) ?? staticMultiUserMode;
    } catch {
      return staticMultiUserMode;
    }
  };
  const ownerCache = new Map<
    string,
    {
      ownerUserId: string;
      cachedAt: number;
    }
  >();

  const resolveOwnerUserIdForSessionKey = (sessionKey: string): string | undefined => {
    const normalized = normalizeToken(sessionKey);
    if (!normalized) {
      return undefined;
    }
    const now = Date.now();
    const cached = ownerCache.get(normalized);
    if (cached && now - cached.cachedAt < OWNER_CACHE_TTL_MS) {
      return cached.ownerUserId;
    }
    let ownerUserId: string | undefined;
    try {
      ownerUserId = normalizeToken(params.resolveOwnerUserIdForSessionKey?.(normalized));
    } catch {
      ownerUserId = undefined;
    }
    if (ownerUserId) {
      ownerCache.set(normalized, { ownerUserId, cachedAt: now });
    } else {
      // Do not cache misses so recently-created or backfilled owners can resolve immediately.
      ownerCache.delete(normalized);
    }
    return ownerUserId;
  };

  const broadcastInternal = (
    event: string,
    payload: unknown,
    opts?: {
      dropIfSlow?: boolean;
      stateVersion?: { presence?: number; health?: number };
    },
    targetConnIds?: ReadonlySet<string>,
  ) => {
    const multiUserMode = resolveActiveMultiUserMode();
    const enforceOwnerFanout = multiUserMode !== "off";
    const requireResolvedPrincipal = multiUserMode !== "off";
    const ownerScoped = OWNER_SCOPED_EVENTS.has(event) && enforceOwnerFanout;
    const eventSessionKey = ownerScoped ? getSessionKeyFromPayload(payload) : undefined;
    const ownerUserId = eventSessionKey
      ? resolveOwnerUserIdForSessionKey(eventSessionKey)
      : undefined;
    const dropMissingOwner = ownerScoped && !ownerUserId;
    const isTargeted = Boolean(targetConnIds);
    const eventSeq = isTargeted ? undefined : ++seq;
    const frame = JSON.stringify({
      type: "event",
      event,
      payload,
      seq: eventSeq,
      stateVersion: opts?.stateVersion,
    });
    const logMeta: Record<string, unknown> = {
      event,
      seq: eventSeq ?? "targeted",
      clients: params.clients.size,
      targets: targetConnIds ? targetConnIds.size : undefined,
      dropIfSlow: opts?.dropIfSlow,
      presenceVersion: opts?.stateVersion?.presence,
      healthVersion: opts?.stateVersion?.health,
      ownerScoped,
      multiUserMode,
      ownerUserId,
      ownerResolved: !ownerScoped || Boolean(ownerUserId),
      droppedMissingOwner: dropMissingOwner,
      sessionKey: eventSessionKey,
    };
    if (event === "agent") {
      Object.assign(logMeta, summarizeAgentEventForWsLog(payload));
    }
    logWs("out", "event", logMeta);
    if (dropMissingOwner) {
      return;
    }
    for (const c of params.clients) {
      if (targetConnIds && !targetConnIds.has(c.connId)) {
        continue;
      }
      if (!hasEventScope(c, event, { requireResolvedPrincipal })) {
        continue;
      }
      if (ownerScoped && !isAdminClient(c, { requireResolvedPrincipal })) {
        const clientOwnerUserId = normalizeToken(c.owner?.userId);
        const ownerMatched = Boolean(
          ownerUserId && clientOwnerUserId && clientOwnerUserId === ownerUserId,
        );
        if (!ownerMatched) {
          const delegated =
            ownerUserId &&
            clientOwnerUserId &&
            params.canAccessOwnerScopedEvent?.({
              event,
              sessionKey: eventSessionKey,
              viewerUserId: clientOwnerUserId,
              ownerUserId,
            }) === true;
          if (!delegated) {
            continue;
          }
        }
      }
      const slow = c.socket.bufferedAmount > MAX_BUFFERED_BYTES;
      if (slow && opts?.dropIfSlow) {
        continue;
      }
      if (slow) {
        try {
          c.socket.close(1008, "slow consumer");
        } catch {
          /* ignore */
        }
        continue;
      }
      try {
        c.socket.send(frame);
      } catch {
        /* ignore */
      }
    }
  };

  const broadcast = (
    event: string,
    payload: unknown,
    opts?: {
      dropIfSlow?: boolean;
      stateVersion?: { presence?: number; health?: number };
    },
  ) => broadcastInternal(event, payload, opts);

  const broadcastToConnIds = (
    event: string,
    payload: unknown,
    connIds: ReadonlySet<string>,
    opts?: {
      dropIfSlow?: boolean;
      stateVersion?: { presence?: number; health?: number };
    },
  ) => {
    if (connIds.size === 0) {
      return;
    }
    broadcastInternal(event, payload, opts, connIds);
  };

  return { broadcast, broadcastToConnIds };
}
