import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () =>
      ({
        session: { scope: "per-sender", mainKey: "main" },
        tools: { agentToAgent: { enabled: false } },
      }) as never,
  };
});

import { createSessionsSendTool } from "./sessions-send-tool.js";

describe("sessions_send gating", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
  });

  it("blocks cross-agent sends when tools.agentToAgent.enabled is false", async () => {
    const tool = createSessionsSendTool({
      agentSessionKey: "agent:main:main",
      agentChannel: "whatsapp",
    });

    const result = await tool.execute("call1", {
      sessionKey: "agent:other:main",
      message: "hi",
      timeoutSeconds: 0,
    });

    expect(callGatewayMock).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({ status: "forbidden" });
  });

  it("forwards owner identity to gateway calls", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-1" };
      }
      return {};
    });

    const tool = createSessionsSendTool({
      agentSessionKey: "agent:main:main",
      agentChannel: "whatsapp",
      ownerUserId: "user-1",
      ownerPrincipalId: "principal:user-1",
      ownerAlias: "alice",
    });

    const result = await tool.execute("call2", {
      sessionKey: "agent:main:main",
      message: "hi",
      timeoutSeconds: 0,
    });

    expect(result.details).toMatchObject({ status: "accepted", runId: "run-1" });
    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "agent",
        identity: {
          userId: "user-1",
          principalId: "principal:user-1",
          alias: "alice",
        },
      }),
    );
  });
});
