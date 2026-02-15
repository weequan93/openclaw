import { describe, expect, it } from "vitest";
import {
  applyGatewayPolicyBundle,
  isGatewayPolicyBundleId,
  listGatewayPolicyBundles,
  resolveGatewayPolicyBundle,
} from "./config-policy-bundles.js";

describe("gateway config policy bundles", () => {
  it("lists supported bundles", () => {
    const bundles = listGatewayPolicyBundles();
    expect(bundles.map((bundle) => bundle.id)).toEqual([
      "single_user",
      "multi_user_isolated",
      "strict_admin_control",
    ]);
  });

  it("resolves bundle metadata", () => {
    const bundle = resolveGatewayPolicyBundle("strict_admin_control");
    expect(bundle?.title).toContain("Strict");
    expect(bundle?.patch).toEqual(
      expect.objectContaining({
        gateway: expect.objectContaining({
          multiUser: expect.objectContaining({ mode: "strict" }),
        }),
      }),
    );
  });

  it("applies bundle patch to config", () => {
    const next = applyGatewayPolicyBundle({
      config: {
        gateway: { multiUser: { mode: "off" } },
        commands: { config: true, debug: true },
      },
      bundleId: "multi_user_isolated",
    });
    expect(next.gateway?.multiUser?.mode).toBe("compat");
    expect(next.commands?.config).toBe(false);
    expect(next.commands?.debug).toBe(false);
  });

  it("validates bundle ids", () => {
    expect(isGatewayPolicyBundleId("single_user")).toBe(true);
    expect(isGatewayPolicyBundleId("missing")).toBe(false);
  });
});
