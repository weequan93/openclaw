import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { GatewayOwnerContext } from "./owner-context.js";
import { enforceBrowserOwnerPolicy } from "./browser-owner-policy.js";

const adminOwner: GatewayOwnerContext = {
  userId: "admin-user",
  principalId: "admin:device:1",
  role: "admin",
  sourceRole: "operator",
  scopes: ["operator.admin"],
};

const userOwner: GatewayOwnerContext = {
  userId: "d6cf56e6-f2ac-4f8a-a6dd-8f6e3572782a",
  principalId: "msg:telegram:default:1001",
  role: "user",
  sourceRole: "operator",
  scopes: ["operator.read", "operator.write"],
};

const baseCfg = {
  browser: {
    defaultProfile: "alice",
    profiles: {
      alice: { cdpPort: 18810, color: "#00AA00", ownerUserId: userOwner.userId },
      shared: { cdpPort: 18811, color: "#00BB00", shared: true },
      bob: { cdpPort: 18812, color: "#00CC00", ownerUserId: "other-user" },
    },
  },
} satisfies OpenClawConfig;

describe("enforceBrowserOwnerPolicy", () => {
  it("allows admins to configure browser profiles", () => {
    const result = enforceBrowserOwnerPolicy({
      cfg: baseCfg,
      owner: adminOwner,
      method: "POST",
      path: "/profiles/create",
      query: {},
      body: { name: "new-profile" },
    });
    expect(result.ok).toBe(true);
  });

  it("denies non-admin profile config mutations", () => {
    const result = enforceBrowserOwnerPolicy({
      cfg: baseCfg,
      owner: userOwner,
      method: "POST",
      path: "/profiles/create",
      query: {},
      body: { name: "new-profile" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("admin-only");
      expect((result.error.details as { reasonCode?: string } | undefined)?.reasonCode).toBe(
        "ROLE_FORBIDDEN",
      );
    }
  });

  it("injects owned default profile when profile is omitted", () => {
    const result = enforceBrowserOwnerPolicy({
      cfg: baseCfg,
      owner: userOwner,
      method: "POST",
      path: "/tabs/open",
      query: {},
      body: { url: "https://example.com" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effectiveProfile).toBe("alice");
      expect(result.query?.profile).toBe("alice");
      expect((result.body as { profile?: string } | undefined)?.profile).toBe("alice");
    }
  });

  it("denies explicit unowned profile access", () => {
    const result = enforceBrowserOwnerPolicy({
      cfg: baseCfg,
      owner: userOwner,
      method: "GET",
      path: "/tabs",
      query: { profile: "bob" },
      body: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("owner mismatch");
      expect((result.error.details as { reasonCode?: string } | undefined)?.reasonCode).toBe(
        "OWNER_MISMATCH",
      );
    }
  });

  it("allows delegated explicit profile access when browser delegation is enabled", () => {
    const result = enforceBrowserOwnerPolicy({
      cfg: {
        ...baseCfg,
        gateway: {
          multiUser: {
            mode: "strict",
            delegation: {
              enabled: true,
              rules: [
                {
                  fromUserId: userOwner.userId,
                  toUserId: "other-user",
                  resources: ["browser"],
                },
              ],
            },
          },
        },
      },
      owner: userOwner,
      method: "GET",
      path: "/tabs",
      query: { profile: "bob" },
      body: undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effectiveProfile).toBe("bob");
    }
  });

  it("allows shared profile access", () => {
    const result = enforceBrowserOwnerPolicy({
      cfg: baseCfg,
      owner: userOwner,
      method: "GET",
      path: "/tabs",
      query: { profile: "shared" },
      body: undefined,
    });
    expect(result.ok).toBe(true);
  });

  it("allows unowned legacy profile in compat mode", () => {
    const result = enforceBrowserOwnerPolicy({
      cfg: {
        ...baseCfg,
        gateway: { multiUser: { mode: "compat" } },
        browser: {
          ...baseCfg.browser,
          profiles: {
            ...(baseCfg.browser?.profiles ?? {}),
            legacy: { cdpPort: 18820, color: "#22AA22" },
          },
          defaultProfile: "legacy",
        },
      },
      owner: userOwner,
      method: "GET",
      path: "/tabs",
      query: { profile: "legacy" },
      body: undefined,
    });
    expect(result.ok).toBe(true);
  });

  it("denies unowned extension relay profile in compat mode", () => {
    const result = enforceBrowserOwnerPolicy({
      cfg: {
        ...baseCfg,
        gateway: { multiUser: { mode: "compat" } },
        browser: {
          ...baseCfg.browser,
          profiles: {
            ...(baseCfg.browser?.profiles ?? {}),
            chrome: {
              driver: "extension",
              cdpUrl: "http://127.0.0.1:19010",
              color: "#00AA00",
            },
          },
          defaultProfile: "chrome",
        },
      },
      owner: userOwner,
      method: "GET",
      path: "/tabs",
      query: { profile: "chrome" },
      body: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("extension relay profile owner mismatch");
      expect((result.error.details as { reasonCode?: string } | undefined)?.reasonCode).toBe(
        "OWNER_MISMATCH",
      );
    }
  });

  it("allows owner-bound extension relay profile in compat mode", () => {
    const result = enforceBrowserOwnerPolicy({
      cfg: {
        ...baseCfg,
        gateway: { multiUser: { mode: "compat" } },
        browser: {
          ...baseCfg.browser,
          profiles: {
            ...(baseCfg.browser?.profiles ?? {}),
            chrome: {
              driver: "extension",
              cdpUrl: "http://127.0.0.1:19010",
              color: "#00AA00",
              ownerUserId: userOwner.userId,
            },
          },
          defaultProfile: "chrome",
        },
      },
      owner: userOwner,
      method: "GET",
      path: "/tabs",
      query: { profile: "chrome" },
      body: undefined,
    });
    expect(result.ok).toBe(true);
  });

  it("allows delegated extension relay profile when browser delegation rule matches", () => {
    const result = enforceBrowserOwnerPolicy({
      cfg: {
        ...baseCfg,
        gateway: {
          multiUser: {
            mode: "strict",
            delegation: {
              enabled: true,
              rules: [
                {
                  fromUserId: userOwner.userId,
                  toUserId: "other-user",
                  resources: ["browser"],
                },
              ],
            },
          },
        },
        browser: {
          ...baseCfg.browser,
          profiles: {
            ...(baseCfg.browser?.profiles ?? {}),
            chrome: {
              driver: "extension",
              cdpUrl: "http://127.0.0.1:19010",
              color: "#00AA00",
              ownerUserId: "other-user",
            },
          },
          defaultProfile: "chrome",
        },
      },
      owner: userOwner,
      method: "GET",
      path: "/tabs",
      query: { profile: "chrome" },
      body: undefined,
    });
    expect(result.ok).toBe(true);
  });

  it("bypasses profile ownership checks in off mode", () => {
    const result = enforceBrowserOwnerPolicy({
      cfg: {
        ...baseCfg,
        gateway: { multiUser: { mode: "off" } },
      },
      owner: userOwner,
      method: "GET",
      path: "/tabs",
      query: { profile: "bob" },
      body: undefined,
    });
    expect(result.ok).toBe(true);
  });
});
