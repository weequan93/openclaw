import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordGatewayAuthzDenyEvent } = vi.hoisted(() => ({
  recordGatewayAuthzDenyEvent: vi.fn(),
}));

vi.mock("../../gateway/authz-denied-events.js", () => ({
  recordGatewayAuthzDenyEvent,
}));

import { recordCommandAuthzDeny } from "./command-authz-audit.js";

describe("recordCommandAuthzDeny", () => {
  beforeEach(() => {
    recordGatewayAuthzDenyEvent.mockReset();
  });

  it("records gateway client metadata when available", () => {
    recordCommandAuthzDeny({
      ctx: {
        GatewayClientScopes: ["operator.write"],
        GatewayClientId: "gateway-client",
        GatewayClientMode: "backend",
        GatewaySourceIp: "203.0.113.7",
        GatewayOwnerUserId: "user-a",
        GatewayOwnerAlias: "Alice",
        GatewayOwnerPrincipalId: "principal:user-a",
        GatewayOwnerRole: "user",
      },
      command: {
        channel: "gateway",
        senderId: "sender-1",
      } as Parameters<typeof recordCommandAuthzDeny>[0]["command"],
      method: "command.debug",
      reasonCode: "ROLE_FORBIDDEN",
      message: "denied",
    });

    expect(recordGatewayAuthzDenyEvent).toHaveBeenCalledTimes(1);
    expect(recordGatewayAuthzDenyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "command.debug",
        reasonCode: "ROLE_FORBIDDEN",
        userId: "user-a",
        userAlias: "Alice",
        principalId: "principal:user-a",
        actorRole: "user",
        sourceRole: "operator",
        clientId: "gateway-client",
        clientMode: "backend",
        sourceIp: "203.0.113.7",
      }),
    );
  });

  it("falls back to surface/provider mode when gateway client mode is missing", () => {
    recordCommandAuthzDeny({
      ctx: {
        Surface: "telegram",
      },
      command: {
        channel: "telegram",
        senderId: "sender-1",
      } as Parameters<typeof recordCommandAuthzDeny>[0]["command"],
      method: "command.help",
      reasonCode: "UNKNOWN_SENDER",
      message: "denied",
    });

    expect(recordGatewayAuthzDenyEvent).toHaveBeenCalledTimes(1);
    expect(recordGatewayAuthzDenyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "command.help",
        reasonCode: "UNKNOWN_SENDER",
        actorRole: null,
        sourceRole: null,
        clientId: null,
        clientMode: "telegram",
        sourceIp: null,
      }),
    );
  });

  it("does not infer admin actor role from admin scope when role is unresolved", () => {
    recordCommandAuthzDeny({
      ctx: {
        GatewayClientScopes: ["operator.admin"],
        GatewayClientId: "gateway-client",
        GatewayClientMode: "backend",
      },
      command: {
        channel: "gateway",
        senderId: "sender-1",
      } as Parameters<typeof recordCommandAuthzDeny>[0]["command"],
      method: "command.config",
      reasonCode: "ROLE_FORBIDDEN",
      message: "denied",
    });

    expect(recordGatewayAuthzDenyEvent).toHaveBeenCalledTimes(1);
    expect(recordGatewayAuthzDenyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "command.config",
        reasonCode: "ROLE_FORBIDDEN",
        actorRole: null,
        sourceRole: "operator",
        clientId: "gateway-client",
        clientMode: "backend",
      }),
    );
  });
});
