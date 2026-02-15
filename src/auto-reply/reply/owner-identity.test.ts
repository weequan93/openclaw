import { describe, expect, it } from "vitest";
import { resolveGatewayOwnerRoleFromContext } from "./owner-identity.js";

describe("resolveGatewayOwnerRoleFromContext", () => {
  it("returns normalized role when value is valid", () => {
    expect(resolveGatewayOwnerRoleFromContext({ GatewayOwnerRole: "admin" })).toBe("admin");
    expect(resolveGatewayOwnerRoleFromContext({ GatewayOwnerRole: "USER" })).toBe("user");
    expect(resolveGatewayOwnerRoleFromContext({ GatewayOwnerRole: " Node " })).toBe("node");
    expect(resolveGatewayOwnerRoleFromContext({ GatewayOwnerRole: "service" })).toBe("service");
  });

  it("returns undefined for invalid or missing role", () => {
    expect(resolveGatewayOwnerRoleFromContext({})).toBeUndefined();
    expect(resolveGatewayOwnerRoleFromContext({ GatewayOwnerRole: "" })).toBeUndefined();
    expect(resolveGatewayOwnerRoleFromContext({ GatewayOwnerRole: "owner" })).toBeUndefined();
  });
});
