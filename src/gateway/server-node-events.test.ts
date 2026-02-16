import { beforeEach, describe, expect, it, vi } from "vitest";

const getPairedNodeMock = vi.fn();
const loadSessionEntryMock = vi.fn();
const updateSessionStoreMock = vi.fn();
const agentCommandMock = vi.fn();
const loadConfigMock = vi.fn();
const normalizeMainKeyMock = vi.fn();

vi.mock("../infra/system-events.js", () => ({
  enqueueSystemEvent: vi.fn(),
}));
vi.mock("../infra/heartbeat-wake.js", () => ({
  requestHeartbeatNow: vi.fn(),
}));
vi.mock("../infra/node-pairing.js", () => ({
  getPairedNode: (...args: unknown[]) => getPairedNodeMock(...args),
}));
vi.mock("./session-utils.js", () => ({
  loadSessionEntry: (...args: unknown[]) => loadSessionEntryMock(...args),
}));
vi.mock("../config/sessions.js", () => ({
  updateSessionStore: async (
    storePath: string,
    mutator: (store: Record<string, unknown>) => Promise<void> | void,
  ) => {
    const store: Record<string, unknown> = {};
    await mutator(store);
    updateSessionStoreMock(storePath, store);
  },
}));
vi.mock("../commands/agent.js", () => ({
  agentCommand: (...args: unknown[]) => agentCommandMock(...args),
}));
vi.mock("../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));
vi.mock("../routing/session-key.js", () => ({
  normalizeMainKey: (...args: unknown[]) => normalizeMainKeyMock(...args),
}));

import type { CliDeps } from "../cli/deps.js";
import type { HealthSummary } from "../commands/health.js";
import type { NodeEventContext } from "./server-node-events-types.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { handleNodeEvent } from "./server-node-events.js";

const enqueueSystemEventMock = vi.mocked(enqueueSystemEvent);
const requestHeartbeatNowMock = vi.mocked(requestHeartbeatNow);

function buildCtx(): NodeEventContext {
  return {
    deps: {} as CliDeps,
    broadcast: () => {},
    nodeSendToSession: () => {},
    nodeSubscribe: () => {},
    nodeUnsubscribe: () => {},
    broadcastVoiceWakeChanged: () => {},
    addChatRun: () => {},
    removeChatRun: () => undefined,
    chatAbortControllers: new Map(),
    chatAbortedRuns: new Map(),
    chatRunBuffers: new Map(),
    chatDeltaSentAt: new Map(),
    dedupe: new Map(),
    agentRunSeq: new Map(),
    getHealthCache: () => null,
    refreshHealthSnapshot: async () => ({}) as HealthSummary,
    loadGatewayModelCatalog: async () => [],
    logGateway: { warn: () => {} },
  };
}

describe("node exec events", () => {
  beforeEach(() => {
    enqueueSystemEventMock.mockReset();
    requestHeartbeatNowMock.mockReset();
    getPairedNodeMock.mockReset();
    loadSessionEntryMock.mockReset();
    updateSessionStoreMock.mockReset();
    agentCommandMock.mockReset();
    loadConfigMock.mockReset();
    normalizeMainKeyMock.mockReset();

    getPairedNodeMock.mockResolvedValue(null);
    loadSessionEntryMock.mockReturnValue({
      storePath: "/tmp/sessions.json",
      entry: undefined,
      canonicalKey: "main",
    });
    agentCommandMock.mockResolvedValue(undefined);
    loadConfigMock.mockReturnValue({
      session: { mainKey: "main" },
      gateway: { multiUser: { mode: "off" } },
    });
    normalizeMainKeyMock.mockImplementation((mainKey: unknown) =>
      typeof mainKey === "string" && mainKey.trim() ? mainKey.trim() : "main",
    );
  });

  it("enqueues exec.started events", async () => {
    const ctx = buildCtx();
    await handleNodeEvent(ctx, "node-1", {
      event: "exec.started",
      payloadJSON: JSON.stringify({
        sessionKey: "agent:main:main",
        runId: "run-1",
        command: "ls -la",
      }),
    });

    expect(enqueueSystemEventMock).toHaveBeenCalledWith(
      "Exec started (node=node-1 id=run-1): ls -la",
      { sessionKey: "agent:main:main", contextKey: "exec:run-1" },
    );
    expect(requestHeartbeatNowMock).toHaveBeenCalledWith({ reason: "exec-event" });
  });

  it("enqueues exec.finished events with output", async () => {
    const ctx = buildCtx();
    await handleNodeEvent(ctx, "node-2", {
      event: "exec.finished",
      payloadJSON: JSON.stringify({
        runId: "run-2",
        exitCode: 0,
        timedOut: false,
        output: "done",
      }),
    });

    expect(enqueueSystemEventMock).toHaveBeenCalledWith(
      "Exec finished (node=node-2 id=run-2, code 0)\ndone",
      { sessionKey: "node-node-2", contextKey: "exec:run-2" },
    );
    expect(requestHeartbeatNowMock).toHaveBeenCalledWith({ reason: "exec-event" });
  });

  it("enqueues exec.denied events with reason", async () => {
    const ctx = buildCtx();
    await handleNodeEvent(ctx, "node-3", {
      event: "exec.denied",
      payloadJSON: JSON.stringify({
        sessionKey: "agent:demo:main",
        runId: "run-3",
        command: "rm -rf /",
        reason: "allowlist-miss",
      }),
    });

    expect(enqueueSystemEventMock).toHaveBeenCalledWith(
      "Exec denied (node=node-3 id=run-3, allowlist-miss): rm -rf /",
      { sessionKey: "agent:demo:main", contextKey: "exec:run-3" },
    );
    expect(requestHeartbeatNowMock).toHaveBeenCalledWith({ reason: "exec-event" });
  });

  it("scopes voice transcript session lookup by paired node owner", async () => {
    const addChatRun = vi.fn();
    const ctx = {
      ...buildCtx(),
      addChatRun,
    };
    getPairedNodeMock.mockResolvedValue({ ownerUserId: "user-node" });
    loadSessionEntryMock.mockReturnValue({
      storePath: "/tmp/sessions.json",
      canonicalKey: "agent:main:main",
      entry: {
        sessionId: "sess-1",
        ownerPrincipalId: "principal-node",
        verboseLevel: "on",
      },
    });

    await handleNodeEvent(ctx, "node-voice", {
      event: "voice.transcript",
      payloadJSON: JSON.stringify({
        text: "hello from node",
        sessionKey: "agent:main:main",
      }),
    });

    expect(loadSessionEntryMock).toHaveBeenCalledWith("agent:main:main", {
      ownerUserId: "user-node",
    });
    expect(updateSessionStoreMock).toHaveBeenCalledTimes(1);
    const [, updatedStore] = updateSessionStoreMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    const updatedEntry = updatedStore["agent:main:main"] as {
      ownerUserId?: string;
      ownerPrincipalId?: string;
      verboseLevel?: string;
      sessionId?: string;
    };
    expect(updatedEntry.ownerUserId).toBe("user-node");
    expect(updatedEntry.ownerPrincipalId).toBe("principal-node");
    expect(updatedEntry.verboseLevel).toBe("on");
    expect(updatedEntry.sessionId).toBe("sess-1");
    expect(addChatRun).toHaveBeenCalled();
    expect(agentCommandMock).toHaveBeenCalled();
  });

  it("preserves existing session owner on agent.request writes", async () => {
    const ctx = buildCtx();
    getPairedNodeMock.mockResolvedValue({ ownerUserId: "user-node" });
    loadSessionEntryMock.mockReturnValue({
      storePath: "/tmp/sessions.json",
      canonicalKey: "agent:main:main",
      entry: {
        sessionId: "sess-2",
        ownerUserId: "user-existing",
        ownerPrincipalId: "principal-existing",
      },
    });

    await handleNodeEvent(ctx, "node-agent", {
      event: "agent.request",
      payloadJSON: JSON.stringify({
        message: "run this",
        sessionKey: "agent:main:main",
      }),
    });

    expect(loadSessionEntryMock).toHaveBeenCalledWith("agent:main:main", {
      ownerUserId: "user-node",
    });
    const [, updatedStore] = updateSessionStoreMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    const updatedEntry = updatedStore["agent:main:main"] as {
      ownerUserId?: string;
      ownerPrincipalId?: string;
    };
    expect(updatedEntry.ownerUserId).toBe("user-existing");
    expect(updatedEntry.ownerPrincipalId).toBe("principal-existing");
    expect(agentCommandMock).toHaveBeenCalled();
  });

  it("denies voice.transcript owner mismatch without delegation", async () => {
    const warn = vi.fn();
    const ctx = {
      ...buildCtx(),
      logGateway: { warn },
    };
    loadConfigMock.mockReturnValue({
      session: { store: "sessions/{ownerUserId}.json" },
      gateway: {
        multiUser: {
          mode: "strict",
          identities: {
            "principal:node": { userId: "user-node" },
            "principal:other": { userId: "user-other" },
          },
        },
      },
    });
    getPairedNodeMock.mockResolvedValue({ ownerUserId: "user-node" });
    loadSessionEntryMock.mockImplementation(
      (_sessionKey: string, opts?: { ownerUserId?: string }) => {
        if (opts?.ownerUserId === "user-node") {
          return {
            storePath: "/tmp/sessions.json",
            canonicalKey: "agent:main:main",
            entry: { ownerUserId: "user-other", sessionId: "sess-3" },
          };
        }
        return {
          storePath: "/tmp/sessions.json",
          canonicalKey: "agent:main:main",
          entry: undefined,
        };
      },
    );

    await handleNodeEvent(ctx, "node-voice-deny", {
      event: "voice.transcript",
      payloadJSON: JSON.stringify({
        text: "should not run",
        sessionKey: "agent:main:main",
      }),
    });

    expect(updateSessionStoreMock).not.toHaveBeenCalled();
    expect(agentCommandMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("node voice.transcript denied node=node-voice-deny"),
    );
  });

  it("denies agent.request for ownerless strict-mode session", async () => {
    const warn = vi.fn();
    const ctx = {
      ...buildCtx(),
      logGateway: { warn },
    };
    loadConfigMock.mockReturnValue({
      session: { store: "sessions/{ownerUserId}.json" },
      gateway: {
        multiUser: {
          mode: "strict",
        },
      },
    });
    getPairedNodeMock.mockResolvedValue({ ownerUserId: "user-node" });
    loadSessionEntryMock.mockReturnValue({
      storePath: "/tmp/sessions.json",
      canonicalKey: "agent:main:main",
      entry: { sessionId: "sess-ownerless" },
    });

    await handleNodeEvent(ctx, "node-agent-deny", {
      event: "agent.request",
      payloadJSON: JSON.stringify({
        message: "should not run",
        sessionKey: "agent:main:main",
      }),
    });

    expect(updateSessionStoreMock).not.toHaveBeenCalled();
    expect(agentCommandMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("node agent.request denied node=node-agent-deny"),
    );
  });

  it("allows chat.subscribe for owned node session in strict mode", async () => {
    const nodeSubscribe = vi.fn();
    const ctx = {
      ...buildCtx(),
      nodeSubscribe,
    };
    loadConfigMock.mockReturnValue({
      session: { store: "sessions/{ownerUserId}.json" },
      gateway: {
        multiUser: {
          mode: "strict",
          identities: {
            "principal:node": { userId: "user-node" },
          },
        },
      },
    });
    getPairedNodeMock.mockResolvedValue({ ownerUserId: "user-node" });
    loadSessionEntryMock.mockImplementation(
      (_sessionKey: string, opts?: { ownerUserId?: string }) => {
        if (opts?.ownerUserId === "user-node") {
          return {
            storePath: "/tmp/user-node/sessions.json",
            canonicalKey: "agent:main:main",
            entry: { ownerUserId: "user-node" },
          };
        }
        return {
          storePath: "/tmp/sessions.json",
          canonicalKey: "agent:main:main",
          entry: undefined,
        };
      },
    );

    await handleNodeEvent(ctx, "node-sub", {
      event: "chat.subscribe",
      payloadJSON: JSON.stringify({ sessionKey: "agent:main:main" }),
    });

    expect(nodeSubscribe).toHaveBeenCalledWith("node-sub", "agent:main:main");
  });

  it("denies chat.subscribe owner mismatch without delegation", async () => {
    const nodeSubscribe = vi.fn();
    const warn = vi.fn();
    const ctx = {
      ...buildCtx(),
      nodeSubscribe,
      logGateway: { warn },
    };
    loadConfigMock.mockReturnValue({
      session: { store: "sessions/{ownerUserId}.json" },
      gateway: {
        multiUser: {
          mode: "strict",
          identities: {
            "principal:node": { userId: "user-node" },
            "principal:other": { userId: "user-other" },
          },
        },
      },
    });
    getPairedNodeMock.mockResolvedValue({ ownerUserId: "user-node" });
    loadSessionEntryMock.mockImplementation(
      (_sessionKey: string, opts?: { ownerUserId?: string }) => {
        if (opts?.ownerUserId === "user-other") {
          return {
            storePath: "/tmp/user-other/sessions.json",
            canonicalKey: "agent:main:main",
            entry: { ownerUserId: "user-other" },
          };
        }
        return {
          storePath: "/tmp/sessions.json",
          canonicalKey: "agent:main:main",
          entry: undefined,
        };
      },
    );

    await handleNodeEvent(ctx, "node-sub-deny", {
      event: "chat.subscribe",
      payloadJSON: JSON.stringify({ sessionKey: "agent:main:main" }),
    });

    expect(nodeSubscribe).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("node subscribe denied node=node-sub-deny"),
    );
  });

  it("allows chat.subscribe owner mismatch with sessions delegation", async () => {
    const nodeSubscribe = vi.fn();
    const ctx = {
      ...buildCtx(),
      nodeSubscribe,
    };
    loadConfigMock.mockReturnValue({
      session: { store: "sessions/{ownerUserId}.json" },
      gateway: {
        multiUser: {
          mode: "strict",
          identities: {
            "principal:node": { userId: "user-node" },
            "principal:other": { userId: "user-other" },
          },
          delegation: {
            enabled: true,
            rules: [
              {
                fromUserId: "user-node",
                toUserId: "user-other",
                resources: ["sessions"],
              },
            ],
          },
        },
      },
    });
    getPairedNodeMock.mockResolvedValue({ ownerUserId: "user-node" });
    loadSessionEntryMock.mockImplementation(
      (_sessionKey: string, opts?: { ownerUserId?: string }) => {
        if (opts?.ownerUserId === "user-other") {
          return {
            storePath: "/tmp/user-other/sessions.json",
            canonicalKey: "agent:main:main",
            entry: { ownerUserId: "user-other" },
          };
        }
        return {
          storePath: "/tmp/sessions.json",
          canonicalKey: "agent:main:main",
          entry: undefined,
        };
      },
    );

    await handleNodeEvent(ctx, "node-sub-delegated", {
      event: "chat.subscribe",
      payloadJSON: JSON.stringify({ sessionKey: "agent:main:main" }),
    });

    expect(nodeSubscribe).toHaveBeenCalledWith("node-sub-delegated", "agent:main:main");
  });

  it("denies chat.unsubscribe when node owner is unresolved in strict mode", async () => {
    const nodeUnsubscribe = vi.fn();
    const warn = vi.fn();
    const ctx = {
      ...buildCtx(),
      nodeUnsubscribe,
      logGateway: { warn },
    };
    loadConfigMock.mockReturnValue({
      session: { store: "sessions/{ownerUserId}.json" },
      gateway: {
        multiUser: {
          mode: "strict",
        },
      },
    });
    getPairedNodeMock.mockResolvedValue(null);

    await handleNodeEvent(ctx, "node-unsub-deny", {
      event: "chat.unsubscribe",
      payloadJSON: JSON.stringify({ sessionKey: "agent:main:main" }),
    });

    expect(nodeUnsubscribe).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("node unsubscribe denied node=node-unsub-deny"),
    );
  });

  it("denies exec events on owner mismatch in strict mode", async () => {
    const warn = vi.fn();
    const ctx = {
      ...buildCtx(),
      logGateway: { warn },
    };
    loadConfigMock.mockReturnValue({
      session: { store: "sessions/{ownerUserId}.json" },
      gateway: {
        multiUser: {
          mode: "strict",
          identities: {
            "principal:node": { userId: "user-node" },
            "principal:other": { userId: "user-other" },
          },
        },
      },
    });
    getPairedNodeMock.mockResolvedValue({ ownerUserId: "user-node" });
    loadSessionEntryMock.mockImplementation(
      (_sessionKey: string, opts?: { ownerUserId?: string }) => {
        if (opts?.ownerUserId === "user-node") {
          return {
            storePath: "/tmp/sessions.json",
            canonicalKey: "agent:main:main",
            entry: { ownerUserId: "user-other" },
          };
        }
        return {
          storePath: "/tmp/sessions.json",
          canonicalKey: "agent:main:main",
          entry: undefined,
        };
      },
    );

    await handleNodeEvent(ctx, "node-exec-deny", {
      event: "exec.started",
      payloadJSON: JSON.stringify({
        sessionKey: "agent:main:main",
        runId: "run-deny",
        command: "whoami",
      }),
    });

    expect(enqueueSystemEventMock).not.toHaveBeenCalled();
    expect(requestHeartbeatNowMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("node exec event denied node=node-exec-deny"),
    );
  });
});
