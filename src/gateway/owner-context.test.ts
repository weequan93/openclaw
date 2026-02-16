import { describe, expect, it } from "vitest";
import type { ConnectParams } from "./protocol/index.js";
import {
  hasConnectSenderIdentity,
  hasExplicitConnectIdentity,
  resolveConnectOwnerContext,
} from "./owner-context.js";

function makeConnect(overrides?: Partial<ConnectParams>): ConnectParams {
  return {
    minProtocol: 1,
    maxProtocol: 1,
    client: {
      id: "test-client",
      version: "1.0.0",
      platform: "darwin",
      mode: "backend",
    },
    role: "operator",
    scopes: ["operator.read"],
    ...overrides,
  };
}

describe("connect owner identity helpers", () => {
  it("detects explicit connect identity mapping", () => {
    const connect = makeConnect({
      identity: {
        userId: "2c394c11-352a-4f4b-a987-26d8613a80ba",
        principalId: "msg:telegram:default:42",
      },
    });
    expect(hasExplicitConnectIdentity(connect)).toBe(true);
    expect(hasConnectSenderIdentity(connect)).toBe(true);
  });

  it("can ignore explicit connect identity when caller trust is restricted", () => {
    const connect = makeConnect({
      identity: {
        userId: "2c394c11-352a-4f4b-a987-26d8613a80ba",
        principalId: "msg:telegram:default:42",
      },
    });
    expect(hasConnectSenderIdentity(connect, { allowExplicitIdentity: false })).toBe(false);
  });

  it("does not treat self-asserted principalId mapping as trusted when explicit identity is disabled", () => {
    const connect = makeConnect({
      identity: {
        userId: "spoof-user",
        principalId: "msg:telegram:default:42",
      },
    });
    expect(
      hasConnectSenderIdentity(connect, {
        allowExplicitIdentity: false,
        mappings: {
          "msg:telegram:default:42": {
            userId: "trusted-user",
            principalId: "msg:telegram:default:42",
            role: "user",
          },
        },
      }),
    ).toBe(false);
  });

  it("requires both userId and principalId for explicit mapping", () => {
    const connect = makeConnect({
      identity: {
        userId: "2c394c11-352a-4f4b-a987-26d8613a80ba",
      } as ConnectParams["identity"],
    });
    expect(hasExplicitConnectIdentity(connect)).toBe(false);
  });

  it("treats paired device identity as known sender identity", () => {
    const connect = makeConnect({
      device: {
        id: "device-123",
        publicKey: "pub",
        signature: "sig",
        signedAt: Date.now(),
      },
    });
    expect(hasExplicitConnectIdentity(connect)).toBe(false);
    expect(hasConnectSenderIdentity(connect)).toBe(true);
  });

  it("reports unknown sender when neither explicit identity nor device id exist", () => {
    const connect = makeConnect();
    expect(hasExplicitConnectIdentity(connect)).toBe(false);
    expect(hasConnectSenderIdentity(connect)).toBe(false);
  });

  it("treats mapped sender identity as known sender", () => {
    const connect = makeConnect({
      device: {
        id: "device-123",
        publicKey: "pub",
        signature: "sig",
        signedAt: Date.now(),
      },
      identity: undefined,
    });
    expect(
      hasConnectSenderIdentity(connect, {
        mappings: {
          "device:device-123": {
            userId: "5f3ae134-b7e8-42ca-95c4-c30457f91a3f",
            alias: "Alice",
          },
        },
      }),
    ).toBe(true);
  });

  it("falls back to legacy owner ids for compat paths", () => {
    const owner = resolveConnectOwnerContext({
      connect: makeConnect(),
      connId: "conn-1",
    });
    expect(owner.userId).toContain("legacy:operator");
    expect(owner.principalId).toContain("client:");
    expect(owner.role).toBe("user");
  });

  it("keeps legacy admin role inference for unmapped admin-scope callers", () => {
    const owner = resolveConnectOwnerContext({
      connect: makeConnect({
        scopes: ["operator.admin", "operator.write"],
      }),
      connId: "conn-admin",
    });
    expect(owner.role).toBe("admin");
    expect(owner.sourceRole).toBe("operator");
  });

  it("ignores explicit owner identity when explicit identity is not trusted", () => {
    const owner = resolveConnectOwnerContext({
      connect: makeConnect({
        device: {
          id: "device-123",
          publicKey: "pub",
          signature: "sig",
          signedAt: Date.now(),
        },
        identity: {
          userId: "spoof-user",
          principalId: "msg:discord:default:spoof-user",
          alias: "SpoofUser",
        },
      }),
      allowExplicitIdentity: false,
    });
    expect(owner.userId).toBe("device-123");
    expect(owner.principalId).toBe("device:device-123");
    expect(owner.alias).toBeUndefined();
  });

  it("ignores principalId mapping candidates from self-asserted identity when explicit identity is not trusted", () => {
    const owner = resolveConnectOwnerContext({
      connect: makeConnect({
        identity: {
          userId: "spoof-user",
          principalId: "msg:discord:default:spoof-user",
          alias: "SpoofUser",
        },
      }),
      allowExplicitIdentity: false,
      mappings: {
        "msg:discord:default:spoof-user": {
          userId: "trusted-user",
          principalId: "msg:discord:default:trusted-user",
          alias: "TrustedUser",
          role: "user",
        },
      },
      connId: "conn-spoof",
    });
    expect(owner.userId).toContain("legacy:operator");
    expect(owner.userId).not.toBe("trusted-user");
    expect(owner.principalId).toContain("client:test-client:default");
    expect(owner.alias).toBeUndefined();
  });

  it("still allows trusted client mapping when explicit identity is not trusted", () => {
    const owner = resolveConnectOwnerContext({
      connect: makeConnect({
        identity: {
          userId: "spoof-user",
          principalId: "msg:discord:default:spoof-user",
          alias: "SpoofUser",
        },
      }),
      allowExplicitIdentity: false,
      mappings: {
        "client:test-client:default": {
          userId: "trusted-client-user",
          principalId: "msg:discord:default:trusted-client-user",
          alias: "TrustedClientUser",
          role: "user",
        },
      },
    });
    expect(owner.userId).toBe("trusted-client-user");
    expect(owner.principalId).toBe("msg:discord:default:trusted-client-user");
    expect(owner.alias).toBe("TrustedClientUser");
  });

  it("resolves owner identity from admin-managed mappings and keeps alias/group ids", () => {
    const owner = resolveConnectOwnerContext({
      connect: makeConnect({
        device: {
          id: "device-123",
          publicKey: "pub",
          signature: "sig",
          signedAt: Date.now(),
        },
      }),
      mappings: {
        "device:device-123": {
          userId: "cb2f3a0e-2f27-4efd-a7ca-e4592825fca8",
          principalId: "msg:telegram:default:12345",
          alias: "Alice",
          groupIds: ["finance", "ops", "finance"],
        },
      },
    });
    expect(owner.userId).toBe("cb2f3a0e-2f27-4efd-a7ca-e4592825fca8");
    expect(owner.principalId).toBe("msg:telegram:default:12345");
    expect(owner.alias).toBe("Alice");
    expect(owner.groupIds).toEqual(["finance", "ops"]);
  });

  it("does not infer admin role from scope when mapped principal role is missing", () => {
    const owner = resolveConnectOwnerContext({
      connect: makeConnect({
        device: {
          id: "device-123",
          publicKey: "pub",
          signature: "sig",
          signedAt: Date.now(),
        },
        scopes: ["operator.admin", "operator.write"],
      }),
      mappings: {
        "device:device-123": {
          userId: "cb2f3a0e-2f27-4efd-a7ca-e4592825fca8",
          principalId: "msg:telegram:default:12345",
          alias: "Alice",
        },
      },
    });
    expect(owner.userId).toBe("cb2f3a0e-2f27-4efd-a7ca-e4592825fca8");
    expect(owner.principalId).toBe("msg:telegram:default:12345");
    expect(owner.alias).toBe("Alice");
    expect(owner.role).toBe("user");
  });
});
