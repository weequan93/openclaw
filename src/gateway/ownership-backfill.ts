import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig, writeConfigFile } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { loadSessionStore, resolveStorePath, updateSessionStore } from "../config/sessions.js";
import { listNodePairing, updatePairedNodeMetadata } from "../infra/node-pairing.js";
import { normalizeAgentId } from "../routing/session-key.js";

export const OWNERSHIP_BACKFILL_RESOURCES = [
  "agents",
  "sessions",
  "nodes",
  "browserProfiles",
  "memory",
] as const;

export type OwnershipBackfillResource = (typeof OWNERSHIP_BACKFILL_RESOURCES)[number];

export type OwnershipBackfillParams = {
  ownerUserId: string;
  ownerPrincipalId?: string;
  dryRun?: boolean;
  resources?: string[];
};

export type OwnershipGapsParams = {
  resources?: string[];
  limit?: number;
};

type OwnershipBackfillStats = {
  scanned: number;
  updated: number;
  skipped: number;
};

type OwnershipBackfillAgentsResult = OwnershipBackfillStats & {
  updatedAgentIds: string[];
};

type OwnershipBackfillBrowserProfilesResult = OwnershipBackfillStats & {
  updatedProfiles: string[];
};

type OwnershipBackfillSessionsResult = OwnershipBackfillStats & {
  storesScanned: number;
  storesUpdated: number;
  updatedStorePaths: string[];
};

type OwnershipBackfillNodesResult = OwnershipBackfillStats & {
  updatedNodeIds: string[];
};

type OwnershipBackfillMemoryResult = OwnershipBackfillStats & {
  updatedPaths: string[];
  unresolvedPaths: string[];
};

export type OwnershipBackfillResult = {
  ts: number;
  dryRun: boolean;
  ownerUserId: string;
  ownerPrincipalId?: string;
  resources: Partial<{
    agents: OwnershipBackfillAgentsResult;
    browserProfiles: OwnershipBackfillBrowserProfilesResult;
    sessions: OwnershipBackfillSessionsResult;
    nodes: OwnershipBackfillNodesResult;
    memory: OwnershipBackfillMemoryResult;
  }>;
  summary: {
    resources: OwnershipBackfillResource[];
    scanned: number;
    updated: number;
    skipped: number;
  };
};

type OwnershipGapStats = {
  scanned: number;
  missing: number;
};

type OwnershipGapsAgentsResult = OwnershipGapStats & {
  missingAgentIds: string[];
};

type OwnershipGapsBrowserProfilesResult = OwnershipGapStats & {
  missingProfiles: string[];
};

type OwnershipGapsNodesResult = OwnershipGapStats & {
  missingNodeIds: string[];
};

type OwnershipGapsSessionsResult = OwnershipGapStats & {
  storesScanned: number;
  storesWithMissing: number;
  missingSamples: Array<{ storePath: string; key: string }>;
};

type OwnershipGapsMemoryResult = OwnershipGapStats & {
  missingPaths: string[];
};

export type OwnershipGapsResult = {
  ts: number;
  resources: OwnershipBackfillResource[];
  limit: number;
  resourcesSummary: Partial<{
    agents: OwnershipGapsAgentsResult;
    browserProfiles: OwnershipGapsBrowserProfilesResult;
    sessions: OwnershipGapsSessionsResult;
    nodes: OwnershipGapsNodesResult;
    memory: OwnershipGapsMemoryResult;
  }>;
  summary: {
    resources: OwnershipBackfillResource[];
    scanned: number;
    missing: number;
  };
};

const OWNERSHIP_BACKFILL_RESOURCE_SET = new Set<string>(OWNERSHIP_BACKFILL_RESOURCES);

function normalizeToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toStats(scanned: number, updated: number): OwnershipBackfillStats {
  return {
    scanned,
    updated,
    skipped: Math.max(0, scanned - updated),
  };
}

function resolveOwnershipGapsLimit(limit: unknown): number {
  if (typeof limit === "number" && Number.isFinite(limit)) {
    return Math.max(1, Math.min(500, Math.floor(limit)));
  }
  return 50;
}

export function resolveOwnershipBackfillResources(
  resources?: string[],
): OwnershipBackfillResource[] {
  if (!Array.isArray(resources) || resources.length === 0) {
    return [...OWNERSHIP_BACKFILL_RESOURCES];
  }
  const seen = new Set<OwnershipBackfillResource>();
  for (const raw of resources) {
    const token = normalizeToken(raw);
    if (!token || !OWNERSHIP_BACKFILL_RESOURCE_SET.has(token)) {
      continue;
    }
    seen.add(token as OwnershipBackfillResource);
  }
  if (seen.size === 0) {
    return [...OWNERSHIP_BACKFILL_RESOURCES];
  }
  return [...seen];
}

function listConfiguredAgentIds(cfg: OpenClawConfig): Set<string> {
  const ids = new Set<string>();
  const defaultAgentId = normalizeAgentId(resolveDefaultAgentId(cfg));
  ids.add(defaultAgentId);
  for (const entry of cfg.agents?.list ?? []) {
    if (!entry?.id) {
      continue;
    }
    ids.add(normalizeAgentId(entry.id));
  }
  return ids;
}

function listAgentIdsFromDisk(): Set<string> {
  const ids = new Set<string>();
  const agentsDir = path.join(resolveStateDir(), "agents");
  try {
    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const id = normalizeAgentId(entry.name);
      if (!id) {
        continue;
      }
      ids.add(id);
    }
  } catch {
    // Best-effort fallback for absent state dir.
  }
  return ids;
}

function collectSessionStorePaths(cfg: OpenClawConfig): string[] {
  const template = cfg.session?.store;
  if (!template || template.includes("{agentId}")) {
    const ids = new Set<string>([...listConfiguredAgentIds(cfg), ...listAgentIdsFromDisk()]);
    return [...ids]
      .map((agentId) => resolveStorePath(template, { agentId }))
      .filter(Boolean)
      .toSorted((a, b) => a.localeCompare(b));
  }
  const defaultAgentId = normalizeAgentId(resolveDefaultAgentId(cfg));
  return [resolveStorePath(template, { agentId: defaultAgentId })];
}

function backfillAgentsInConfig(params: { cfg: OpenClawConfig; ownerUserId: string }): {
  cfg: OpenClawConfig;
  result: OwnershipBackfillAgentsResult;
} {
  const entries = Array.isArray(params.cfg.agents?.list) ? params.cfg.agents.list : [];
  const updatedAgentIds: string[] = [];
  let updated = 0;
  const nextEntries = entries.map((entry) => {
    if (normalizeToken(entry?.ownerUserId)) {
      return entry;
    }
    updated += 1;
    const agentId = normalizeToken(entry?.id);
    if (agentId) {
      updatedAgentIds.push(agentId);
    }
    return {
      ...entry,
      ownerUserId: params.ownerUserId,
    };
  });
  if (updated === 0) {
    return {
      cfg: params.cfg,
      result: {
        ...toStats(entries.length, 0),
        updatedAgentIds: [],
      },
    };
  }
  return {
    cfg: {
      ...params.cfg,
      agents: {
        ...params.cfg.agents,
        list: nextEntries,
      },
    },
    result: {
      ...toStats(entries.length, updated),
      updatedAgentIds,
    },
  };
}

function backfillBrowserProfilesInConfig(params: { cfg: OpenClawConfig; ownerUserId: string }): {
  cfg: OpenClawConfig;
  result: OwnershipBackfillBrowserProfilesResult;
} {
  const profiles = params.cfg.browser?.profiles ?? {};
  const names = Object.keys(profiles);
  if (names.length === 0) {
    return {
      cfg: params.cfg,
      result: {
        ...toStats(0, 0),
        updatedProfiles: [],
      },
    };
  }

  const nextProfiles: Record<string, (typeof profiles)[string]> = { ...profiles };
  const updatedProfiles: string[] = [];
  let updated = 0;

  for (const name of names) {
    const profile = profiles[name];
    if (!profile) {
      continue;
    }
    if (profile.shared === true || normalizeToken(profile.ownerUserId)) {
      continue;
    }
    updated += 1;
    updatedProfiles.push(name);
    nextProfiles[name] = {
      ...profile,
      ownerUserId: params.ownerUserId,
    };
  }

  if (updated === 0) {
    return {
      cfg: params.cfg,
      result: {
        ...toStats(names.length, 0),
        updatedProfiles: [],
      },
    };
  }

  return {
    cfg: {
      ...params.cfg,
      browser: {
        ...params.cfg.browser,
        profiles: nextProfiles,
      },
    },
    result: {
      ...toStats(names.length, updated),
      updatedProfiles,
    },
  };
}

function needsSessionOwnerBackfill(params: {
  entry: SessionEntry;
  ownerUserId: string;
  ownerPrincipalId?: string;
}): boolean {
  const currentOwner = normalizeToken(params.entry.ownerUserId);
  const currentPrincipal = normalizeToken(params.entry.ownerPrincipalId);
  const needsOwner = !currentOwner;
  const needsPrincipal =
    Boolean(params.ownerPrincipalId) &&
    !currentPrincipal &&
    (!currentOwner || currentOwner === params.ownerUserId);
  return needsOwner || needsPrincipal;
}

async function backfillSessionStore(params: {
  storePath: string;
  ownerUserId: string;
  ownerPrincipalId?: string;
  dryRun: boolean;
}): Promise<{ scanned: number; updated: number }> {
  const previewStore = loadSessionStore(params.storePath);
  const keysToPatch: string[] = [];
  let scanned = 0;
  for (const [key, entry] of Object.entries(previewStore)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    scanned += 1;
    if (
      needsSessionOwnerBackfill({
        entry,
        ownerUserId: params.ownerUserId,
        ownerPrincipalId: params.ownerPrincipalId,
      })
    ) {
      keysToPatch.push(key);
    }
  }
  if (keysToPatch.length === 0) {
    return { scanned, updated: 0 };
  }
  if (params.dryRun) {
    return { scanned, updated: keysToPatch.length };
  }
  let updated = 0;
  await updateSessionStore(params.storePath, (store) => {
    for (const key of keysToPatch) {
      const entry = store[key];
      if (!entry || typeof entry !== "object") {
        continue;
      }
      if (
        !needsSessionOwnerBackfill({
          entry,
          ownerUserId: params.ownerUserId,
          ownerPrincipalId: params.ownerPrincipalId,
        })
      ) {
        continue;
      }
      let changed = false;
      const currentOwner = normalizeToken(entry.ownerUserId);
      const currentPrincipal = normalizeToken(entry.ownerPrincipalId);
      if (!currentOwner) {
        entry.ownerUserId = params.ownerUserId;
        changed = true;
      }
      const effectiveOwner = normalizeToken(entry.ownerUserId);
      if (params.ownerPrincipalId && !currentPrincipal && effectiveOwner === params.ownerUserId) {
        entry.ownerPrincipalId = params.ownerPrincipalId;
        changed = true;
      }
      if (changed) {
        updated += 1;
      }
    }
  });
  return { scanned, updated };
}

async function backfillSessions(params: {
  cfg: OpenClawConfig;
  ownerUserId: string;
  ownerPrincipalId?: string;
  dryRun: boolean;
}): Promise<OwnershipBackfillSessionsResult> {
  const storePaths = collectSessionStorePaths(params.cfg);
  let scanned = 0;
  let updated = 0;
  const updatedStorePaths: string[] = [];
  for (const storePath of storePaths) {
    const result = await backfillSessionStore({
      storePath,
      ownerUserId: params.ownerUserId,
      ownerPrincipalId: params.ownerPrincipalId,
      dryRun: params.dryRun,
    });
    scanned += result.scanned;
    updated += result.updated;
    if (result.updated > 0) {
      updatedStorePaths.push(storePath);
    }
  }
  return {
    ...toStats(scanned, updated),
    storesScanned: storePaths.length,
    storesUpdated: updatedStorePaths.length,
    updatedStorePaths,
  };
}

async function backfillNodes(params: {
  ownerUserId: string;
  dryRun: boolean;
}): Promise<OwnershipBackfillNodesResult> {
  const pairing = await listNodePairing();
  const updatedNodeIds: string[] = [];
  for (const node of pairing.paired) {
    if (normalizeToken(node.ownerUserId)) {
      continue;
    }
    updatedNodeIds.push(node.nodeId);
    if (!params.dryRun) {
      await updatePairedNodeMetadata(node.nodeId, { ownerUserId: params.ownerUserId });
    }
  }
  return {
    ...toStats(pairing.paired.length, updatedNodeIds.length),
    updatedNodeIds,
  };
}

function backfillMemoryInConfig(params: { cfg: OpenClawConfig; dryRun: boolean }): {
  cfg: OpenClawConfig;
  result: OwnershipBackfillMemoryResult;
} {
  const qmd = params.cfg.memory?.qmd;
  if (!qmd || typeof qmd !== "object") {
    return {
      cfg: params.cfg,
      result: {
        ...toStats(0, 0),
        updatedPaths: [],
        unresolvedPaths: [],
      },
    };
  }

  let scanned = 0;
  let updated = 0;
  const updatedPaths: string[] = [];
  const unresolvedPaths: string[] = [];
  const nextQmd: Record<string, unknown> = { ...(qmd as Record<string, unknown>) };

  if (Array.isArray(qmd.paths)) {
    qmd.paths.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const rawPath = normalizeToken((entry as { path?: unknown }).path);
      if (!rawPath) {
        return;
      }
      scanned += 1;
      if (!rawPath.includes("{ownerUserId}")) {
        unresolvedPaths.push(`memory.qmd.paths[${index}].path`);
      }
    });
  }

  const exportDirRaw = normalizeToken(qmd.sessions?.exportDir);
  if (exportDirRaw) {
    scanned += 1;
    if (!exportDirRaw.includes("{ownerUserId}")) {
      if (!params.dryRun) {
        const trimmed = exportDirRaw.replace(/\/+$/g, "");
        const exportDirTemplate = `${trimmed}/{ownerUserId}`;
        nextQmd.sessions = {
          ...qmd.sessions,
          exportDir: exportDirTemplate,
        };
      }
      updated += 1;
      updatedPaths.push("memory.qmd.sessions.exportDir");
    }
  }

  if (updated === 0 || params.dryRun) {
    return {
      cfg: params.cfg,
      result: {
        ...toStats(scanned, updated),
        updatedPaths,
        unresolvedPaths,
      },
    };
  }

  return {
    cfg: {
      ...params.cfg,
      memory: {
        ...params.cfg.memory,
        qmd: nextQmd as NonNullable<OpenClawConfig["memory"]>["qmd"],
      },
    },
    result: {
      ...toStats(scanned, updated),
      updatedPaths,
      unresolvedPaths,
    },
  };
}

function scanAgentOwnershipGaps(params: {
  cfg: OpenClawConfig;
  limit: number;
}): OwnershipGapsAgentsResult {
  const entries = Array.isArray(params.cfg.agents?.list) ? params.cfg.agents.list : [];
  const missingAgentIds = entries
    .filter((entry) => !normalizeToken(entry?.ownerUserId))
    .map((entry) => normalizeToken(entry?.id))
    .filter((value): value is string => Boolean(value))
    .slice(0, params.limit);
  return {
    scanned: entries.length,
    missing: entries.filter((entry) => !normalizeToken(entry?.ownerUserId)).length,
    missingAgentIds,
  };
}

function scanBrowserProfileOwnershipGaps(params: {
  cfg: OpenClawConfig;
  limit: number;
}): OwnershipGapsBrowserProfilesResult {
  const profiles = params.cfg.browser?.profiles ?? {};
  const names = Object.keys(profiles);
  const missingProfiles: string[] = [];
  let missing = 0;
  for (const name of names) {
    const profile = profiles[name];
    if (!profile || profile.shared === true || normalizeToken(profile.ownerUserId)) {
      continue;
    }
    missing += 1;
    if (missingProfiles.length < params.limit) {
      missingProfiles.push(name);
    }
  }
  return {
    scanned: names.length,
    missing,
    missingProfiles,
  };
}

async function scanNodeOwnershipGaps(params: { limit: number }): Promise<OwnershipGapsNodesResult> {
  const pairing = await listNodePairing();
  const missingNodeIds: string[] = [];
  let missing = 0;
  for (const node of pairing.paired) {
    if (normalizeToken(node.ownerUserId)) {
      continue;
    }
    missing += 1;
    if (missingNodeIds.length < params.limit) {
      missingNodeIds.push(node.nodeId);
    }
  }
  return {
    scanned: pairing.paired.length,
    missing,
    missingNodeIds,
  };
}

function scanSessionOwnershipGaps(params: {
  cfg: OpenClawConfig;
  limit: number;
}): OwnershipGapsSessionsResult {
  const storePaths = collectSessionStorePaths(params.cfg);
  let scanned = 0;
  let missing = 0;
  let storesWithMissing = 0;
  const missingSamples: Array<{ storePath: string; key: string }> = [];
  for (const storePath of storePaths) {
    const store = loadSessionStore(storePath);
    let missingInStore = 0;
    for (const [key, entry] of Object.entries(store)) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      scanned += 1;
      if (normalizeToken(entry.ownerUserId)) {
        continue;
      }
      missing += 1;
      missingInStore += 1;
      if (missingSamples.length < params.limit) {
        missingSamples.push({ storePath, key });
      }
    }
    if (missingInStore > 0) {
      storesWithMissing += 1;
    }
  }
  return {
    scanned,
    missing,
    storesScanned: storePaths.length,
    storesWithMissing,
    missingSamples,
  };
}

function scanMemoryOwnershipGaps(params: {
  cfg: OpenClawConfig;
  limit: number;
}): OwnershipGapsMemoryResult {
  const qmd = params.cfg.memory?.qmd;
  if (!qmd || typeof qmd !== "object") {
    return {
      scanned: 0,
      missing: 0,
      missingPaths: [],
    };
  }

  let scanned = 0;
  let missing = 0;
  const missingPaths: string[] = [];

  if (Array.isArray(qmd.paths)) {
    qmd.paths.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const rawPath = normalizeToken((entry as { path?: unknown }).path);
      if (!rawPath) {
        return;
      }
      scanned += 1;
      if (rawPath.includes("{ownerUserId}")) {
        return;
      }
      missing += 1;
      if (missingPaths.length < params.limit) {
        missingPaths.push(`memory.qmd.paths[${index}].path`);
      }
    });
  }

  const exportDirRaw = normalizeToken(qmd.sessions?.exportDir);
  if (exportDirRaw) {
    scanned += 1;
    if (!exportDirRaw.includes("{ownerUserId}")) {
      missing += 1;
      if (missingPaths.length < params.limit) {
        missingPaths.push("memory.qmd.sessions.exportDir");
      }
    }
  }

  return {
    scanned,
    missing,
    missingPaths,
  };
}

export async function listGatewayOwnershipGaps(
  params: OwnershipGapsParams = {},
): Promise<OwnershipGapsResult> {
  const cfg = loadConfig();
  const resources = resolveOwnershipBackfillResources(params.resources);
  const limit = resolveOwnershipGapsLimit(params.limit);
  const resourcesSummary: OwnershipGapsResult["resourcesSummary"] = {};

  if (resources.includes("agents")) {
    resourcesSummary.agents = scanAgentOwnershipGaps({ cfg, limit });
  }
  if (resources.includes("browserProfiles")) {
    resourcesSummary.browserProfiles = scanBrowserProfileOwnershipGaps({ cfg, limit });
  }
  if (resources.includes("sessions")) {
    resourcesSummary.sessions = scanSessionOwnershipGaps({ cfg, limit });
  }
  if (resources.includes("nodes")) {
    resourcesSummary.nodes = await scanNodeOwnershipGaps({ limit });
  }
  if (resources.includes("memory")) {
    resourcesSummary.memory = scanMemoryOwnershipGaps({ cfg, limit });
  }

  const summary = Object.values(resourcesSummary).reduce(
    (acc, item) => {
      if (!item) {
        return acc;
      }
      acc.scanned += item.scanned;
      acc.missing += item.missing;
      return acc;
    },
    { scanned: 0, missing: 0 },
  );

  return {
    ts: Date.now(),
    resources,
    limit,
    resourcesSummary,
    summary: {
      resources,
      scanned: summary.scanned,
      missing: summary.missing,
    },
  };
}

export async function backfillGatewayOwnership(
  params: OwnershipBackfillParams,
): Promise<OwnershipBackfillResult> {
  const ownerUserId = normalizeToken(params.ownerUserId);
  if (!ownerUserId) {
    throw new Error("ownerUserId required");
  }
  const ownerPrincipalId = normalizeToken(params.ownerPrincipalId);
  const dryRun = params.dryRun === true;
  const resources = resolveOwnershipBackfillResources(params.resources);

  const initialConfig = loadConfig();
  let nextConfig = initialConfig;
  const results: OwnershipBackfillResult["resources"] = {};

  if (resources.includes("agents")) {
    const agents = backfillAgentsInConfig({
      cfg: nextConfig,
      ownerUserId,
    });
    nextConfig = agents.cfg;
    results.agents = agents.result;
  }

  if (resources.includes("browserProfiles")) {
    const profiles = backfillBrowserProfilesInConfig({
      cfg: nextConfig,
      ownerUserId,
    });
    nextConfig = profiles.cfg;
    results.browserProfiles = profiles.result;
  }

  if (resources.includes("memory")) {
    const memory = backfillMemoryInConfig({
      cfg: nextConfig,
      dryRun,
    });
    nextConfig = memory.cfg;
    results.memory = memory.result;
  }

  const configChanged = nextConfig !== initialConfig;
  if (configChanged && !dryRun) {
    await writeConfigFile(nextConfig);
  }

  if (resources.includes("sessions")) {
    results.sessions = await backfillSessions({
      cfg: nextConfig,
      ownerUserId,
      ownerPrincipalId,
      dryRun,
    });
  }

  if (resources.includes("nodes")) {
    results.nodes = await backfillNodes({ ownerUserId, dryRun });
  }

  const aggregate = Object.values(results).reduce(
    (acc, item) => {
      if (!item) {
        return acc;
      }
      acc.scanned += item.scanned;
      acc.updated += item.updated;
      return acc;
    },
    { scanned: 0, updated: 0 },
  );

  return {
    ts: Date.now(),
    dryRun,
    ownerUserId,
    ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
    resources: results,
    summary: {
      resources,
      scanned: aggregate.scanned,
      updated: aggregate.updated,
      skipped: Math.max(0, aggregate.scanned - aggregate.updated),
    },
  };
}
