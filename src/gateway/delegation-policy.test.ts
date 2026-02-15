import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { hasGatewayDelegatedAccess } from "./delegation-policy.js";

describe("gateway delegation policy", () => {
  it("denies delegated access by default", () => {
    const cfg = {
      gateway: { multiUser: { mode: "strict" } },
    } as OpenClawConfig;
    expect(
      hasGatewayDelegatedAccess({
        cfg,
        fromUserId: "user-a",
        ownerUserId: "user-b",
        resource: "agents",
      }),
    ).toBe(false);
  });

  it("allows delegated access when enabled rule matches resource", () => {
    const cfg = {
      gateway: {
        multiUser: {
          mode: "strict",
          delegation: {
            enabled: true,
            rules: [
              {
                fromUserId: "user-a",
                toUserId: "user-b",
                resources: ["agents"],
              },
            ],
          },
        },
      },
    } as OpenClawConfig;
    expect(
      hasGatewayDelegatedAccess({
        cfg,
        fromUserId: "user-a",
        ownerUserId: "user-b",
        resource: "agents",
      }),
    ).toBe(true);
    expect(
      hasGatewayDelegatedAccess({
        cfg,
        fromUserId: "user-a",
        ownerUserId: "user-b",
        resource: "nodes",
      }),
    ).toBe(false);
  });
});
