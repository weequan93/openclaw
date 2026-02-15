import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { assertAgentOwnership, resolveAgentOwnerUserId } from "./agent-owner-policy.js";

describe("agent owner policy", () => {
  const cfg = {
    agents: {
      list: [
        { id: "main", ownerUserId: "user-a" },
        { id: "ops", ownerUserId: "user-b" },
      ],
    },
  } as OpenClawConfig;

  it("resolves owner for configured agent", () => {
    expect(resolveAgentOwnerUserId({ cfg, agentId: "main" })).toBe("user-a");
    expect(resolveAgentOwnerUserId({ cfg, agentId: "ops" })).toBe("user-b");
  });

  it("allows admin access regardless of owner", () => {
    const access = assertAgentOwnership({
      cfg,
      agentId: "ops",
      owner: {
        userId: "admin-1",
        principalId: "admin:1",
        role: "admin",
        sourceRole: "operator",
        scopes: ["operator.admin"],
      },
    });
    expect(access.ok).toBe(true);
  });

  it("denies non-admin access when owner mismatches", () => {
    const access = assertAgentOwnership({
      cfg,
      agentId: "ops",
      owner: {
        userId: "user-a",
        principalId: "user:a",
        role: "user",
        sourceRole: "operator",
        scopes: ["operator.write"],
      },
    });
    expect(access.ok).toBe(false);
    if (access.ok) {
      return;
    }
    expect(access.error.message).toBe("agent owner mismatch");
  });

  it("allows delegated cross-owner access when rule is enabled", () => {
    const access = assertAgentOwnership({
      cfg: {
        ...cfg,
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
      } as OpenClawConfig,
      agentId: "ops",
      owner: {
        userId: "user-a",
        principalId: "user:a",
        role: "user",
        sourceRole: "operator",
        scopes: ["operator.write"],
      },
    });
    expect(access.ok).toBe(true);
  });

  it("allows missing owner metadata in compat mode", () => {
    const access = assertAgentOwnership({
      cfg: {
        gateway: { multiUser: { mode: "compat" } },
        agents: { list: [{ id: "ops" }] },
      } as OpenClawConfig,
      agentId: "ops",
      owner: {
        userId: "user-a",
        principalId: "user:a",
        role: "user",
        sourceRole: "operator",
        scopes: ["operator.write"],
      },
    });
    expect(access.ok).toBe(true);
  });

  it("disables owner checks in off mode", () => {
    const access = assertAgentOwnership({
      cfg: {
        gateway: { multiUser: { mode: "off" } },
        agents: { list: [{ id: "ops", ownerUserId: "user-b" }] },
      } as OpenClawConfig,
      agentId: "ops",
      owner: {
        userId: "user-a",
        principalId: "user:a",
        role: "user",
        sourceRole: "operator",
        scopes: ["operator.write"],
      },
    });
    expect(access.ok).toBe(true);
  });
});
