import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  waitForAgentJob: vi.fn(),
  resolveAgentRunOwner: vi.fn(),
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("./agent-job.js", async () => {
  const actual = await vi.importActual<typeof import("./agent-job.js")>("./agent-job.js");
  return {
    ...actual,
    waitForAgentJob: mocks.waitForAgentJob,
    resolveAgentRunOwner: mocks.resolveAgentRunOwner,
    registerAgentRunOwner: vi.fn(),
  };
});

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    loadConfig: mocks.loadConfig,
  };
});

import { agentHandlers } from "./agent.js";

describe("agent.wait ownership", () => {
  it("denies non-admin owner mismatch", async () => {
    mocks.resolveAgentRunOwner.mockReturnValueOnce("other-user");
    const respond = vi.fn();
    await agentHandlers["agent.wait"]({
      params: { runId: "run-1", timeoutMs: 1000 },
      respond,
      context: {} as never,
      req: { type: "req", id: "1", method: "agent.wait" },
      client: null,
      owner: {
        userId: "user-a",
        principalId: "user:a",
        role: "user",
        sourceRole: "operator",
        scopes: ["operator.read"],
      },
      isWebchatConnect: () => false,
    });

    expect(mocks.waitForAgentJob).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "run owner mismatch" }),
    );
  });

  it("allows owner-matched user", async () => {
    mocks.resolveAgentRunOwner.mockReturnValueOnce("user-a");
    mocks.waitForAgentJob.mockResolvedValueOnce({
      runId: "run-1",
      status: "ok",
      ts: Date.now(),
      startedAt: Date.now() - 100,
      endedAt: Date.now(),
    });
    const respond = vi.fn();
    await agentHandlers["agent.wait"]({
      params: { runId: "run-1", timeoutMs: 1000 },
      respond,
      context: {} as never,
      req: { type: "req", id: "1", method: "agent.wait" },
      client: null,
      owner: {
        userId: "user-a",
        principalId: "user:a",
        role: "user",
        sourceRole: "operator",
        scopes: ["operator.read"],
      },
      isWebchatConnect: () => false,
    });

    expect(mocks.waitForAgentJob).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        runId: "run-1",
        status: "ok",
      }),
    );
  });

  it("allows delegated run owner access for non-admin user", async () => {
    mocks.loadConfig.mockReturnValueOnce({
      gateway: {
        multiUser: {
          mode: "strict",
          delegation: {
            enabled: true,
            rules: [
              {
                fromUserId: "user-a",
                toUserId: "user-b",
                resources: ["agents"],
              },
            ],
          },
        },
      },
    });
    mocks.resolveAgentRunOwner.mockReturnValueOnce("user-b");
    mocks.waitForAgentJob.mockResolvedValueOnce({
      runId: "run-2",
      status: "ok",
      ts: Date.now(),
      startedAt: Date.now() - 100,
      endedAt: Date.now(),
    });
    const respond = vi.fn();
    await agentHandlers["agent.wait"]({
      params: { runId: "run-2", timeoutMs: 1000 },
      respond,
      context: {} as never,
      req: { type: "req", id: "2", method: "agent.wait" },
      client: null,
      owner: {
        userId: "user-a",
        principalId: "user:a",
        role: "user",
        sourceRole: "operator",
        scopes: ["operator.read"],
      },
      isWebchatConnect: () => false,
    });

    expect(mocks.waitForAgentJob).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        runId: "run-2",
        status: "ok",
      }),
    );
  });
});
