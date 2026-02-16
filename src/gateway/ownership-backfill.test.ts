import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  writeConfigFile: vi.fn(async (_cfg: unknown) => {}),
  sessionStores: new Map<string, Record<string, Record<string, unknown>>>(),
  pairedNodes: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: () => testState.config,
  writeConfigFile: async (cfg: unknown) => {
    testState.config = cfg as Record<string, unknown>;
    await testState.writeConfigFile(cfg);
  },
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: () => "main",
}));

vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => "/state",
}));

vi.mock("../config/sessions.js", () => ({
  resolveStorePath: (store?: string, opts?: { agentId?: string }) => {
    const agentId =
      typeof opts?.agentId === "string" && opts.agentId.trim() ? opts.agentId : "main";
    if (typeof store === "string" && store.includes("{agentId}")) {
      return store.replaceAll("{agentId}", agentId);
    }
    if (typeof store === "string" && store.trim()) {
      return store;
    }
    return `/state/agents/${agentId}/sessions/sessions.json`;
  },
  loadSessionStore: (storePath: string) =>
    structuredClone(testState.sessionStores.get(storePath) ?? {}),
  updateSessionStore: async (
    storePath: string,
    mutator: (store: Record<string, unknown>) => void | Promise<void>,
  ) => {
    const store = structuredClone(testState.sessionStores.get(storePath) ?? {});
    await mutator(store);
    testState.sessionStores.set(storePath, store);
    return undefined;
  },
}));

vi.mock("../infra/node-pairing.js", () => ({
  listNodePairing: async () => ({
    pending: [],
    paired: [...testState.pairedNodes.values()],
  }),
  updatePairedNodeMetadata: async (nodeId: string, patch: { ownerUserId?: string }) => {
    const existing = testState.pairedNodes.get(nodeId);
    if (!existing) {
      return;
    }
    testState.pairedNodes.set(nodeId, {
      ...existing,
      ...(patch.ownerUserId ? { ownerUserId: patch.ownerUserId } : {}),
    });
  },
}));

import { backfillGatewayOwnership, listGatewayOwnershipGaps } from "./ownership-backfill.js";

describe("backfillGatewayOwnership", () => {
  beforeEach(() => {
    testState.writeConfigFile.mockReset();
    testState.sessionStores.clear();
    testState.pairedNodes.clear();
    testState.config = {
      session: {
        store: "/state/agents/{agentId}/sessions/sessions.json",
      },
      agents: {
        list: [
          { id: "main", name: "Main" },
          { id: "ops", name: "Ops", ownerUserId: "owner-existing" },
        ],
      },
      browser: {
        profiles: {
          alice: { cdpPort: 18810, color: "#00AA00" },
          shared: { cdpPort: 18811, color: "#00BB00", shared: true },
          owned: { cdpPort: 18812, color: "#00CC00", ownerUserId: "owner-existing" },
        },
      },
    };
    testState.sessionStores.set("/state/agents/main/sessions/sessions.json", {
      "agent:main:chat-a": { sessionId: "s-main-a", updatedAt: 1 },
      "agent:main:chat-b": { sessionId: "s-main-b", updatedAt: 2, ownerUserId: "owner-other" },
    });
    testState.sessionStores.set("/state/agents/ops/sessions/sessions.json", {
      "agent:ops:chat-c": { sessionId: "s-ops-c", updatedAt: 3 },
      "agent:ops:chat-d": {
        sessionId: "s-ops-d",
        updatedAt: 4,
        ownerUserId: "owner-existing",
      },
    });
    testState.pairedNodes.set("node-a", { nodeId: "node-a" });
    testState.pairedNodes.set("node-b", { nodeId: "node-b", ownerUserId: "owner-existing" });
  });

  it("supports dry-run without mutating stores", async () => {
    const result = await backfillGatewayOwnership({
      ownerUserId: "owner-new",
      ownerPrincipalId: "principal:new",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.resources.agents?.updated).toBe(1);
    expect(result.resources.browserProfiles?.updated).toBe(1);
    expect(result.resources.sessions?.updated).toBe(2);
    expect(result.resources.nodes?.updated).toBe(1);
    expect(testState.writeConfigFile).not.toHaveBeenCalled();

    const mainStore = testState.sessionStores.get("/state/agents/main/sessions/sessions.json");
    expect(mainStore?.["agent:main:chat-a"]?.ownerUserId).toBeUndefined();
    expect(testState.pairedNodes.get("node-a")?.ownerUserId).toBeUndefined();
  });

  it("applies owner metadata for missing entries", async () => {
    const result = await backfillGatewayOwnership({
      ownerUserId: "owner-new",
      ownerPrincipalId: "principal:new",
    });

    expect(result.dryRun).toBe(false);
    expect(testState.writeConfigFile).toHaveBeenCalledTimes(1);
    const nextConfig = testState.config as {
      agents?: { list?: Array<{ id: string; ownerUserId?: string }> };
      browser?: {
        profiles?: Record<string, { ownerUserId?: string; shared?: boolean }>;
      };
    };
    expect(nextConfig.agents?.list?.find((entry) => entry.id === "main")?.ownerUserId).toBe(
      "owner-new",
    );
    expect(nextConfig.agents?.list?.find((entry) => entry.id === "ops")?.ownerUserId).toBe(
      "owner-existing",
    );
    expect(nextConfig.browser?.profiles?.alice?.ownerUserId).toBe("owner-new");
    expect(nextConfig.browser?.profiles?.shared?.ownerUserId).toBeUndefined();

    const mainStore = testState.sessionStores.get("/state/agents/main/sessions/sessions.json");
    expect(mainStore?.["agent:main:chat-a"]?.ownerUserId).toBe("owner-new");
    expect(mainStore?.["agent:main:chat-a"]?.ownerPrincipalId).toBe("principal:new");
    expect(mainStore?.["agent:main:chat-b"]?.ownerUserId).toBe("owner-other");
    expect(mainStore?.["agent:main:chat-b"]?.ownerPrincipalId).toBeUndefined();

    const opsStore = testState.sessionStores.get("/state/agents/ops/sessions/sessions.json");
    expect(opsStore?.["agent:ops:chat-c"]?.ownerUserId).toBe("owner-new");
    expect(opsStore?.["agent:ops:chat-c"]?.ownerPrincipalId).toBe("principal:new");

    expect(testState.pairedNodes.get("node-a")?.ownerUserId).toBe("owner-new");
    expect(testState.pairedNodes.get("node-b")?.ownerUserId).toBe("owner-existing");
    expect(result.summary.updated).toBe(5);
  });

  it("lists ownership gaps with resource summaries", async () => {
    const result = await listGatewayOwnershipGaps({
      resources: ["agents", "browserProfiles", "sessions", "nodes"],
      limit: 10,
    });

    expect(result.resourcesSummary.agents).toEqual({
      scanned: 2,
      missing: 1,
      missingAgentIds: ["main"],
    });
    expect(result.resourcesSummary.browserProfiles).toEqual({
      scanned: 3,
      missing: 1,
      missingProfiles: ["alice"],
    });
    expect(result.resourcesSummary.nodes).toEqual({
      scanned: 2,
      missing: 1,
      missingNodeIds: ["node-a"],
    });
    expect(result.resourcesSummary.sessions).toMatchObject({
      storesScanned: 2,
      scanned: 4,
      missing: 2,
      storesWithMissing: 2,
    });
    expect(result.summary).toMatchObject({
      scanned: 11,
      missing: 5,
    });
  });

  it("backfills memory exportDir template and flags unresolved qmd path ownership", async () => {
    testState.config = {
      ...testState.config,
      memory: {
        backend: "qmd",
        qmd: {
          paths: [{ path: "/state/memory-index", name: "main" }],
          sessions: { enabled: true, exportDir: "/state/qmd/sessions" },
        },
      },
    };

    const result = await backfillGatewayOwnership({
      ownerUserId: "owner-new",
      resources: ["memory"],
    });

    expect(result.resources.memory).toMatchObject({
      scanned: 2,
      updated: 1,
      updatedPaths: ["memory.qmd.sessions.exportDir"],
      unresolvedPaths: ["memory.qmd.paths[0].path"],
    });
    const nextConfig = testState.config as {
      memory?: { qmd?: { sessions?: { exportDir?: string } } };
    };
    expect(nextConfig.memory?.qmd?.sessions?.exportDir).toBe("/state/qmd/sessions/{ownerUserId}");
  });

  it("includes memory ownership gaps in resource summary", async () => {
    testState.config = {
      ...testState.config,
      memory: {
        backend: "qmd",
        qmd: {
          paths: [{ path: "/state/memory-index", name: "main" }],
          sessions: { enabled: true, exportDir: "/state/qmd/sessions" },
        },
      },
    };

    const result = await listGatewayOwnershipGaps({
      resources: ["memory"],
      limit: 10,
    });

    expect(result.resourcesSummary.memory).toEqual({
      scanned: 2,
      missing: 2,
      missingPaths: ["memory.qmd.paths[0].path", "memory.qmd.sessions.exportDir"],
    });
    expect(result.summary).toMatchObject({
      scanned: 2,
      missing: 2,
    });
  });
});
