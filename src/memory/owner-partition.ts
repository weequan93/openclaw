import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveSessionFilePath, resolveStorePath } from "../config/sessions/paths.js";
import { loadSessionStore } from "../config/sessions/store.js";
import type { SessionEntry } from "../config/sessions/types.js";

function trimToken(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeOwnerUserId(value: string | null | undefined): string | undefined {
  return trimToken(value);
}

export function resolveOwnerPartitionKey(value: string | null | undefined): string | undefined {
  const normalized = normalizeOwnerUserId(value);
  if (!normalized) {
    return undefined;
  }
  const safe = normalized
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || undefined;
}

export function resolveOwnerPartitionedDirectory(baseDir: string, ownerUserId?: string): string {
  const ownerPartition = resolveOwnerPartitionKey(ownerUserId);
  if (!ownerPartition) {
    return baseDir;
  }
  return path.join(baseDir, ownerPartition);
}

export function resolveOwnerPartitionedFile(filePath: string, ownerUserId?: string): string {
  const ownerPartition = resolveOwnerPartitionKey(ownerUserId);
  if (!ownerPartition) {
    return filePath;
  }
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, ownerPartition, parsed.base);
}

function resolveSessionStorePath(cfg: OpenClawConfig, agentId: string): string {
  return resolveStorePath(cfg.session?.store, { agentId });
}

export function resolveSessionOwnerUserId(params: {
  cfg: OpenClawConfig;
  agentId: string;
  sessionKey?: string;
}): string | undefined {
  const sessionKey = trimToken(params.sessionKey);
  if (!sessionKey) {
    return undefined;
  }
  const storePath = resolveSessionStorePath(params.cfg, params.agentId);
  const store = loadSessionStore(storePath);
  return normalizeOwnerUserId(store[sessionKey]?.ownerUserId);
}

export function resolveOwnedSessionFilesForAgent(params: {
  cfg: OpenClawConfig;
  agentId: string;
  ownerUserId?: string;
}): Set<string> | null {
  const ownerUserId = normalizeOwnerUserId(params.ownerUserId);
  if (!ownerUserId) {
    return null;
  }
  const storePath = resolveSessionStorePath(params.cfg, params.agentId);
  const store = loadSessionStore(storePath);
  const owned = new Set<string>();
  for (const entry of Object.values(store)) {
    const sessionOwner = normalizeOwnerUserId(entry?.ownerUserId);
    if (!sessionOwner || sessionOwner !== ownerUserId) {
      continue;
    }
    const sessionId = trimToken(entry?.sessionId);
    if (!sessionId) {
      continue;
    }
    const sessionFile = resolveSessionFilePath(sessionId, entry as SessionEntry, {
      agentId: params.agentId,
    });
    owned.add(path.resolve(sessionFile));
  }
  return owned;
}
