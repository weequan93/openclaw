import { loadConfig } from "../config/config.js";
import { getAgentRunContext, registerAgentRunContext } from "../infra/agent-events.js";
import { toAgentRequestSessionKey } from "../routing/session-key.js";
import { resolveAgentRunOwner } from "./server-methods/agent-job.js";
import { loadCombinedSessionStoreForGateway } from "./session-utils.js";

function normalizeOwnerToken(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function listOwnerCandidates(params: {
  cfg: ReturnType<typeof loadConfig>;
  runOwnerUserId?: string;
}): string[] {
  const owners = new Set<string>();
  const runOwnerUserId = normalizeOwnerToken(params.runOwnerUserId);
  if (runOwnerUserId) {
    owners.add(runOwnerUserId);
  }
  const identities = params.cfg.gateway?.multiUser?.identities;
  if (identities && typeof identities === "object") {
    for (const value of Object.values(identities)) {
      const userId = normalizeOwnerToken((value as { userId?: unknown } | undefined)?.userId);
      if (userId) {
        owners.add(userId);
      }
    }
  }
  return Array.from(owners);
}

export function resolveSessionKeyForRun(runId: string) {
  const cached = getAgentRunContext(runId)?.sessionKey;
  if (cached) {
    return cached;
  }
  const cfg = loadConfig();
  const ownerCandidates = listOwnerCandidates({ cfg, runOwnerUserId: resolveAgentRunOwner(runId) });

  for (const ownerUserId of ownerCandidates) {
    const { store } = loadCombinedSessionStoreForGateway(cfg, { ownerUserId });
    const found = Object.entries(store).find(([, entry]) => entry?.sessionId === runId);
    const storeKey = found?.[0];
    if (!storeKey) {
      continue;
    }
    const sessionKey = toAgentRequestSessionKey(storeKey) ?? storeKey;
    registerAgentRunContext(runId, { sessionKey });
    return sessionKey;
  }

  const { store } = loadCombinedSessionStoreForGateway(cfg);
  const found = Object.entries(store).find(([, entry]) => entry?.sessionId === runId);
  const storeKey = found?.[0];
  if (!storeKey) {
    return undefined;
  }
  const sessionKey = toAgentRequestSessionKey(storeKey) ?? storeKey;
  registerAgentRunContext(runId, { sessionKey });
  return sessionKey;
}
