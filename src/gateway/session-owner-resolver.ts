import type { OpenClawConfig } from "../config/config.js";
import { loadSessionEntry } from "./session-utils.js";

function normalizeToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function listKnownOwnerUserIds(cfg: OpenClawConfig): string[] {
  const ownerIds = new Set<string>();
  for (const mapping of Object.values(cfg.gateway?.multiUser?.identities ?? {})) {
    const ownerUserId = normalizeToken(mapping?.userId);
    if (ownerUserId) {
      ownerIds.add(ownerUserId);
    }
  }
  for (const entry of cfg.agents?.list ?? []) {
    const ownerUserId = normalizeToken(entry?.ownerUserId);
    if (ownerUserId) {
      ownerIds.add(ownerUserId);
    }
  }
  for (const profile of Object.values(cfg.browser?.profiles ?? {})) {
    const ownerUserId = normalizeToken(
      (profile as { ownerUserId?: string | undefined } | undefined)?.ownerUserId,
    );
    if (ownerUserId) {
      ownerIds.add(ownerUserId);
    }
  }
  return Array.from(ownerIds);
}

function resolveOwnerFromScopedLookup(params: {
  sessionKey: string;
  ownerUserId: string;
}): string | undefined {
  return normalizeToken(
    loadSessionEntry(params.sessionKey, {
      ownerUserId: params.ownerUserId,
    }).entry?.ownerUserId,
  );
}

export function resolveSessionOwnerUserIdForGateway(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
  preferredOwnerUserId?: string;
}): string | undefined {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    return undefined;
  }
  const preferredOwnerUserId = normalizeToken(params.preferredOwnerUserId);
  try {
    if (preferredOwnerUserId) {
      const preferredOwner = resolveOwnerFromScopedLookup({
        sessionKey,
        ownerUserId: preferredOwnerUserId,
      });
      if (preferredOwner) {
        return preferredOwner;
      }
    }

    const storeTemplate =
      typeof params.cfg.session?.store === "string" ? params.cfg.session.store : "";
    if (storeTemplate.includes("{ownerUserId}")) {
      for (const ownerUserId of listKnownOwnerUserIds(params.cfg)) {
        if (preferredOwnerUserId && ownerUserId === preferredOwnerUserId) {
          continue;
        }
        const resolvedOwner = resolveOwnerFromScopedLookup({
          sessionKey,
          ownerUserId,
        });
        if (resolvedOwner) {
          return resolvedOwner;
        }
      }
      return undefined;
    }

    return normalizeToken(loadSessionEntry(sessionKey).entry?.ownerUserId);
  } catch {
    return undefined;
  }
}
