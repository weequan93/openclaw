import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.fn();
const getAgentRunContextMock = vi.fn();
const registerAgentRunContextMock = vi.fn();
const toAgentRequestSessionKeyMock = vi.fn();
const resolveAgentRunOwnerMock = vi.fn();
const loadCombinedSessionStoreForGatewayMock = vi.fn();

vi.mock("../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

vi.mock("../infra/agent-events.js", () => ({
  getAgentRunContext: (runId: string) => getAgentRunContextMock(runId),
  registerAgentRunContext: (runId: string, context: { sessionKey?: string }) =>
    registerAgentRunContextMock(runId, context),
}));

vi.mock("../routing/session-key.js", () => ({
  toAgentRequestSessionKey: (key: string) => toAgentRequestSessionKeyMock(key),
}));

vi.mock("./server-methods/agent-job.js", () => ({
  resolveAgentRunOwner: (runId: string) => resolveAgentRunOwnerMock(runId),
}));

vi.mock("./session-utils.js", () => ({
  loadCombinedSessionStoreForGateway: (cfg: unknown, opts?: { ownerUserId?: string }) =>
    loadCombinedSessionStoreForGatewayMock(cfg, opts),
}));

import { resolveSessionKeyForRun } from "./server-session-key.js";

describe("resolveSessionKeyForRun", () => {
  beforeEach(() => {
    loadConfigMock.mockReset();
    getAgentRunContextMock.mockReset();
    registerAgentRunContextMock.mockReset();
    toAgentRequestSessionKeyMock.mockReset();
    resolveAgentRunOwnerMock.mockReset();
    loadCombinedSessionStoreForGatewayMock.mockReset();
    toAgentRequestSessionKeyMock.mockImplementation((key: string) => `normalized:${key}`);
    loadConfigMock.mockReturnValue({});
    getAgentRunContextMock.mockReturnValue(undefined);
    resolveAgentRunOwnerMock.mockReturnValue(undefined);
    loadCombinedSessionStoreForGatewayMock.mockReturnValue({
      storePath: "/tmp/sessions.json",
      store: {},
    });
  });

  it("returns cached session key from run context", () => {
    getAgentRunContextMock.mockReturnValue({ sessionKey: "cached-key" });
    const result = resolveSessionKeyForRun("run-cached");
    expect(result).toBe("cached-key");
    expect(loadCombinedSessionStoreForGatewayMock).not.toHaveBeenCalled();
    expect(registerAgentRunContextMock).not.toHaveBeenCalled();
  });

  it("resolves from owner partition when run owner is known", () => {
    resolveAgentRunOwnerMock.mockReturnValue("user-a");
    loadCombinedSessionStoreForGatewayMock.mockImplementation(
      (_cfg: unknown, opts?: { ownerUserId?: string }) => {
        if (opts?.ownerUserId === "user-a") {
          return {
            storePath: "/tmp/user-a/sessions.json",
            store: { "agent:main:chat": { sessionId: "run-owner" } },
          };
        }
        return { storePath: "/tmp/sessions.json", store: {} };
      },
    );

    const result = resolveSessionKeyForRun("run-owner");
    expect(result).toBe("normalized:agent:main:chat");
    expect(loadCombinedSessionStoreForGatewayMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ ownerUserId: "user-a" }),
    );
    expect(registerAgentRunContextMock).toHaveBeenCalledWith("run-owner", {
      sessionKey: "normalized:agent:main:chat",
    });
  });

  it("falls back to mapped identity owner partitions when run owner is unknown", () => {
    loadConfigMock.mockReturnValue({
      gateway: {
        multiUser: {
          identities: {
            "principal:a": { userId: "user-a" },
            "principal:b": { userId: "user-b" },
          },
        },
      },
    });
    loadCombinedSessionStoreForGatewayMock.mockImplementation(
      (_cfg: unknown, opts?: { ownerUserId?: string }) => {
        if (opts?.ownerUserId === "user-b") {
          return {
            storePath: "/tmp/user-b/sessions.json",
            store: { "agent:research:main": { sessionId: "run-user-b" } },
          };
        }
        return { storePath: "/tmp/default/sessions.json", store: {} };
      },
    );

    const result = resolveSessionKeyForRun("run-user-b");
    expect(result).toBe("normalized:agent:research:main");
    expect(loadCombinedSessionStoreForGatewayMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ ownerUserId: "user-a" }),
    );
    expect(loadCombinedSessionStoreForGatewayMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ ownerUserId: "user-b" }),
    );
    expect(registerAgentRunContextMock).toHaveBeenCalledWith("run-user-b", {
      sessionKey: "normalized:agent:research:main",
    });
  });

  it("falls back to default combined store when owner candidates miss", () => {
    resolveAgentRunOwnerMock.mockReturnValue("user-a");
    loadCombinedSessionStoreForGatewayMock.mockImplementation(
      (_cfg: unknown, opts?: { ownerUserId?: string }) => {
        if (opts?.ownerUserId === "user-a") {
          return { storePath: "/tmp/user-a/sessions.json", store: {} };
        }
        return {
          storePath: "/tmp/default/sessions.json",
          store: { "agent:main:fallback": { sessionId: "run-fallback" } },
        };
      },
    );

    const result = resolveSessionKeyForRun("run-fallback");
    expect(result).toBe("normalized:agent:main:fallback");
    expect(loadCombinedSessionStoreForGatewayMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      undefined,
    );
    expect(registerAgentRunContextMock).toHaveBeenCalledWith("run-fallback", {
      sessionKey: "normalized:agent:main:fallback",
    });
  });

  it("returns undefined when no matching run is found", () => {
    const result = resolveSessionKeyForRun("run-missing");
    expect(result).toBeUndefined();
    expect(registerAgentRunContextMock).not.toHaveBeenCalled();
  });
});
