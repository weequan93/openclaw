import { describe, expect, it } from "vitest";
import { resolveChannelConfigWrites, resolveGatewayConfigAdminAccess } from "./config-writes.js";

describe("resolveChannelConfigWrites", () => {
  it("defaults to allow when unset", () => {
    const cfg = {};
    expect(resolveChannelConfigWrites({ cfg, channelId: "slack" })).toBe(true);
  });

  it("blocks when channel config disables writes", () => {
    const cfg = { channels: { slack: { configWrites: false } } };
    expect(resolveChannelConfigWrites({ cfg, channelId: "slack" })).toBe(false);
  });

  it("account override wins over channel default", () => {
    const cfg = {
      channels: {
        slack: {
          configWrites: true,
          accounts: {
            work: { configWrites: false },
          },
        },
      },
    };
    expect(resolveChannelConfigWrites({ cfg, channelId: "slack", accountId: "work" })).toBe(false);
  });

  it("matches account ids case-insensitively", () => {
    const cfg = {
      channels: {
        slack: {
          configWrites: true,
          accounts: {
            Work: { configWrites: false },
          },
        },
      },
    };
    expect(resolveChannelConfigWrites({ cfg, channelId: "slack", accountId: "work" })).toBe(false);
  });
});

describe("resolveGatewayConfigAdminAccess", () => {
  it("allows non-gateway contexts when cfg is omitted", () => {
    expect(resolveGatewayConfigAdminAccess({ ctx: undefined })).toBe(true);
    expect(resolveGatewayConfigAdminAccess({ ctx: {} })).toBe(true);
  });

  it("allows non-gateway contexts when multi-user mode is off", () => {
    expect(
      resolveGatewayConfigAdminAccess({
        cfg: { gateway: { multiUser: { mode: "off" } } },
        ctx: {},
      }),
    ).toBe(true);
  });

  it("denies non-gateway contexts when multi-user mode is strict", () => {
    expect(
      resolveGatewayConfigAdminAccess({
        cfg: { gateway: { multiUser: { mode: "strict" } } },
        ctx: {},
      }),
    ).toBe(false);
  });

  it("denies gateway principals without operator.admin scope", () => {
    expect(
      resolveGatewayConfigAdminAccess({
        cfg: { gateway: { multiUser: { mode: "strict" } } },
        ctx: {
          GatewayOwnerUserId: "user-1",
          GatewayOwnerPrincipalId: "principal:user-1",
          GatewayClientScopes: ["operator.write"],
        },
      }),
    ).toBe(false);
  });

  it("allows gateway principals with operator.admin scope", () => {
    expect(
      resolveGatewayConfigAdminAccess({
        cfg: { gateway: { multiUser: { mode: "strict" } } },
        ctx: {
          GatewayOwnerUserId: "admin-1",
          GatewayOwnerPrincipalId: "principal:admin-1",
          GatewayOwnerRole: "admin",
          GatewayClientScopes: ["operator.admin", "operator.write"],
        },
      }),
    ).toBe(true);
  });

  it("denies gateway principals with operator.admin scope when role is non-admin", () => {
    expect(
      resolveGatewayConfigAdminAccess({
        cfg: { gateway: { multiUser: { mode: "strict" } } },
        ctx: {
          GatewayOwnerUserId: "user-1",
          GatewayOwnerPrincipalId: "principal:user-1",
          GatewayOwnerRole: "user",
          GatewayClientScopes: ["operator.admin", "operator.write"],
        },
      }),
    ).toBe(false);
  });
});
