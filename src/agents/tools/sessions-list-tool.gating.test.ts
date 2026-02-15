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

import { createSessionsListTool } from "./sessions-list-tool.js";

describe("sessions_list gating", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    callGatewayMock.mockResolvedValue({
      path: "/tmp/sessions.json",
      sessions: [
        { key: "agent:main:main", kind: "direct" },
        { key: "agent:other:main", kind: "direct" },
      ],
    });
  });

  it("filters out other agents when tools.agentToAgent.enabled is false", async () => {
    const tool = createSessionsListTool({ agentSessionKey: "agent:main:main" });
    const result = await tool.execute("call1", {});
    expect(result.details).toMatchObject({
      count: 1,
      sessions: [{ key: "agent:main:main" }],
    });
  });

  it("forwards owner identity to gateway calls", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "sessions.list") {
        return {
          path: "/tmp/sessions.json",
          sessions: [{ key: "agent:main:main", kind: "direct" }],
        };
      }
      if (request.method === "chat.history") {
        return {
          messages: [{ role: "assistant", content: [{ type: "text", text: "ok" }] }],
        };
      }
      return {};
    });

    const tool = createSessionsListTool({
      agentSessionKey: "agent:main:main",
      ownerUserId: "user-1",
      ownerPrincipalId: "principal:user-1",
      ownerAlias: "alice",
    });
    const result = await tool.execute("call2", { messageLimit: 1 });
    expect(result.details).toMatchObject({
      count: 1,
    });
    const expectedIdentity = {
      userId: "user-1",
      principalId: "principal:user-1",
      alias: "alice",
    };
    const sessionsListCall = callGatewayMock.mock.calls.find(
      (call) => (call[0] as { method?: string }).method === "sessions.list",
    )?.[0] as { identity?: unknown } | undefined;
    const chatHistoryCall = callGatewayMock.mock.calls.find(
      (call) => (call[0] as { method?: string }).method === "chat.history",
    )?.[0] as { identity?: unknown } | undefined;
    expect(sessionsListCall?.identity).toEqual(expectedIdentity);
    expect(chatHistoryCall?.identity).toEqual(expectedIdentity);
  });
});
