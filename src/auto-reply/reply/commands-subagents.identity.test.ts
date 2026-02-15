import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { MsgContext } from "../templating.js";
import type { HandleCommandsParams } from "./commands-types.js";
import {
  addSubagentRunForTests,
  resetSubagentRegistryForTests,
} from "../../agents/subagent-registry.js";
import {
  __test as authzDeniedEventsTest,
  listGatewayAuthzDenyEvents,
} from "../../gateway/authz-denied-events.js";
import { handleSubagentsCommand } from "./commands-subagents.js";

const callGatewayMock = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

function buildParams(
  commandBodyNormalized: string,
  options?: { isAuthorizedSender?: boolean },
): HandleCommandsParams {
  const cfg = {
    session: { mainKey: "main", scope: "per-sender" },
    channels: { whatsapp: { allowFrom: ["*"] } },
  } as OpenClawConfig;
  const ctx = {
    GatewayOwnerUserId: "user-1",
    GatewayOwnerAlias: "Alice",
    GatewayOwnerPrincipalId: "principal:user-1",
  } as MsgContext;
  return {
    ctx,
    cfg,
    command: {
      surface: "whatsapp",
      channel: "whatsapp",
      ownerList: [],
      senderIsOwner: true,
      isAuthorizedSender: options?.isAuthorizedSender ?? true,
      rawBodyNormalized: commandBodyNormalized,
      commandBodyNormalized,
      senderId: "sender-1",
    },
    directives: {},
    elevated: { enabled: true, allowed: true, failures: [] },
    sessionKey: "agent:main:main",
    workspaceDir: "/tmp",
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "whatsapp",
    model: "test-model",
    contextTokens: 0,
    isGroup: false,
  };
}

describe("subagents command owner identity", () => {
  beforeEach(() => {
    resetSubagentRegistryForTests();
    callGatewayMock.mockReset();
    authzDeniedEventsTest.clear();
  });

  it("forwards owner identity for /subagents send gateway calls", async () => {
    addSubagentRunForTests({
      runId: "run-1",
      childSessionKey: "agent:main:subagent:abc",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "do thing",
      cleanup: "keep",
      createdAt: 1000,
    });
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-send" };
      }
      if (request.method === "agent.wait") {
        return { status: "ok" };
      }
      if (request.method === "chat.history") {
        return {
          messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }],
        };
      }
      return {};
    });

    const result = await handleSubagentsCommand(buildParams("/subagents send 1 hello"), true);
    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("done");

    const expectedIdentity = {
      userId: "user-1",
      principalId: "principal:user-1",
      alias: "Alice",
    };
    const agentCall = callGatewayMock.mock.calls.find(
      (call) => (call[0] as { method?: string }).method === "agent",
    )?.[0] as { identity?: unknown } | undefined;
    const waitCall = callGatewayMock.mock.calls.find(
      (call) => (call[0] as { method?: string }).method === "agent.wait",
    )?.[0] as { identity?: unknown } | undefined;
    const historyCall = callGatewayMock.mock.calls.find(
      (call) => (call[0] as { method?: string }).method === "chat.history",
    )?.[0] as { identity?: unknown } | undefined;
    expect(agentCall?.identity).toEqual(expectedIdentity);
    expect(waitCall?.identity).toEqual(expectedIdentity);
    expect(historyCall?.identity).toEqual(expectedIdentity);
  });

  it("records authz deny event for unauthorized sender", async () => {
    const result = await handleSubagentsCommand(
      buildParams("/subagents list", { isAuthorizedSender: false }),
      true,
    );
    expect(result?.shouldContinue).toBe(false);
    expect(callGatewayMock).not.toHaveBeenCalled();

    const events = listGatewayAuthzDenyEvents({ method: "command.subagents" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });
});
