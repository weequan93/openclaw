import { describe, expect, it, vi, beforeEach } from "vitest";
import { __test as denyEventsTest, listGatewayAuthzDenyEvents } from "./authz-denied-events.js";
import { ErrorCodes, errorShape, type RequestFrame } from "./protocol/index.js";
import { handleGatewayRequest } from "./server-methods.js";
import type { GatewayClient, GatewayRequestContext } from "./server-methods/types.js";

const request: RequestFrame = {
  type: "req",
  id: "req-1",
  method: "health",
  params: {},
};

function makeClient(): GatewayClient {
  return {
    connId: "conn-1",
    clientIp: "203.0.113.7",
    connect: {
      minProtocol: 1,
      maxProtocol: 1,
      client: {
        id: "test-client",
        version: "1.0.0",
        platform: "test",
        mode: "test",
      },
      role: "operator",
      scopes: ["operator.read"],
    },
  };
}

function makeContext() {
  return {
    logGateway: {
      warn: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown as GatewayRequestContext;
}

describe("gateway handler deny auditing", () => {
  beforeEach(() => {
    denyEventsTest.clear();
  });

  it("records handler denies with explicit reasonCode", async () => {
    const respond = vi.fn();
    const context = makeContext();
    await handleGatewayRequest({
      req: request,
      client: makeClient(),
      isWebchatConnect: () => false,
      respond,
      context,
      extraHandlers: {
        health: ({ respond }) => {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "session owner mismatch", {
              details: { reasonCode: "OWNER_MISMATCH" },
            }),
          );
        },
      },
    });

    const event = listGatewayAuthzDenyEvents({ limit: 1 })[0];
    expect(event?.requestId).toBe("req-1");
    expect(event?.method).toBe("health");
    expect(event?.reasonCode).toBe("OWNER_MISMATCH");
    expect(event?.errorMessage).toContain("session owner mismatch");
    expect(event?.clientId).toBe("test-client");
    expect(event?.clientMode).toBe("test");
    expect(event?.sourceIp).toBe("203.0.113.7");
  });

  it("falls back to POLICY_DENY when handler error has no reason code", async () => {
    const respond = vi.fn();
    const context = makeContext();
    await handleGatewayRequest({
      req: request,
      client: makeClient(),
      isWebchatConnect: () => false,
      respond,
      context,
      extraHandlers: {
        health: ({ respond }) => {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "policy blocked"));
        },
      },
    });

    const event = listGatewayAuthzDenyEvents({ limit: 1 })[0];
    expect(event?.requestId).toBe("req-1");
    expect(event?.reasonCode).toBe("POLICY_DENY");
    expect(event?.errorMessage).toContain("policy blocked");
  });
});
