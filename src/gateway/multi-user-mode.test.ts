import { describe, expect, it } from "vitest";
import {
  isGatewayOwnerEnforcementEnabled,
  resolveGatewayMultiUserMode,
} from "./multi-user-mode.js";

describe("gateway multi-user mode", () => {
  it("defaults to strict when mode is unset", () => {
    expect(resolveGatewayMultiUserMode({})).toBe("strict");
  });

  it("respects explicit mode values", () => {
    expect(resolveGatewayMultiUserMode({ gateway: { multiUser: { mode: "off" } } })).toBe("off");
    expect(resolveGatewayMultiUserMode({ gateway: { multiUser: { mode: "compat" } } })).toBe(
      "compat",
    );
    expect(resolveGatewayMultiUserMode({ gateway: { multiUser: { mode: "strict" } } })).toBe(
      "strict",
    );
  });

  it("disables owner enforcement for non-admin users in off mode", () => {
    expect(
      isGatewayOwnerEnforcementEnabled({
        cfg: { gateway: { multiUser: { mode: "off" } } },
        owner: {
          userId: "user-1",
          principalId: "principal:user-1",
          role: "user",
          sourceRole: "operator",
          scopes: ["operator.read"],
        },
      }),
    ).toBe(false);
  });
});
