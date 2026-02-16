import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { MsgContext } from "../templating.js";
import type { HandleCommandsParams } from "./commands-types.js";
import {
  __test as authzDeniedEventsTest,
  listGatewayAuthzDenyEvents,
} from "../../gateway/authz-denied-events.js";
import { handlePTTCommand } from "./commands-ptt.js";

const callGatewayMock = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
  randomIdempotencyKey: () => "idem-1",
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

describe("ptt command owner identity", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    authzDeniedEventsTest.clear();
  });

  it("forwards owner identity to node list and invoke gateway calls", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "node.list") {
        return {
          nodes: [{ nodeId: "node-1", displayName: "iphone", platform: "ios", connected: true }],
        };
      }
      if (request.method === "node.invoke") {
        return { ok: true, payload: { status: "ok", captureId: "cap-1" } };
      }
      return {};
    });

    const result = await handlePTTCommand(buildParams("/ptt once"), true);
    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("PTT once");

    const expectedIdentity = {
      userId: "user-1",
      principalId: "principal:user-1",
      alias: "Alice",
    };
    const listCall = callGatewayMock.mock.calls.find(
      (call) => (call[0] as { method?: string }).method === "node.list",
    )?.[0] as { identity?: unknown } | undefined;
    const invokeCall = callGatewayMock.mock.calls.find(
      (call) => (call[0] as { method?: string }).method === "node.invoke",
    )?.[0] as { identity?: unknown } | undefined;
    expect(listCall?.identity).toEqual(expectedIdentity);
    expect(invokeCall?.identity).toEqual(expectedIdentity);
  });

  it("does not use node.pair.list fallback in owner-bound mode", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "node.list") {
        throw new Error("node list denied");
      }
      if (request.method === "node.pair.list") {
        throw new Error("should not be called");
      }
      return {};
    });

    const result = await handlePTTCommand(buildParams("/ptt once"), true);
    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("PTT failed: node list denied");
    const pairingCall = callGatewayMock.mock.calls.find(
      (call) => (call[0] as { method?: string }).method === "node.pair.list",
    );
    expect(pairingCall).toBeUndefined();
  });

  it("records authz deny event for unauthorized sender", async () => {
    const result = await handlePTTCommand(
      buildParams("/ptt once", { isAuthorizedSender: false }),
      true,
    );
    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("authorized sender");
    expect(callGatewayMock).not.toHaveBeenCalled();

    const events = listGatewayAuthzDenyEvents({ method: "command.ptt" });
    expect(events).toHaveLength(1);
    expect(events[0]?.reasonCode).toBe("UNKNOWN_SENDER");
  });
});
