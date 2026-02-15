import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../config/sessions.js";
import type { GatewayOwnerContext } from "./owner-context.js";
import { assertSessionAccess, sessionOwnedByUser, stampSessionOwner } from "./session-owner.js";

const userOwner: GatewayOwnerContext = {
  userId: "2bf8de03-15f4-43de-8bcc-ff6ce84f2a3d",
  principalId: "msg:telegram:default:10001",
  role: "user",
  sourceRole: "operator",
  scopes: ["operator.read", "operator.write"],
};

const adminOwner: GatewayOwnerContext = {
  userId: "admin-user",
  principalId: "admin:device:1",
  role: "admin",
  sourceRole: "operator",
  scopes: ["operator.admin"],
};

describe("assertSessionAccess", () => {
  it("allows access for matching user owner", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: Date.now(),
      ownerUserId: userOwner.userId,
    };
    const result = assertSessionAccess({
      owner: userOwner,
      entry,
      sessionKey: "agent:main:main",
    });
    expect(result.ok).toBe(true);
  });

  it("denies access when owner does not match", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: Date.now(),
      ownerUserId: "other-user",
    };
    const result = assertSessionAccess({
      owner: userOwner,
      entry,
      sessionKey: "agent:main:main",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("owner mismatch");
      expect((result.error.details as { reasonCode?: string } | undefined)?.reasonCode).toBe(
        "OWNER_MISMATCH",
      );
    }
  });

  it("allows delegated access when explicit sessions delegation rule matches", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: Date.now(),
      ownerUserId: "other-user",
    };
    const result = assertSessionAccess({
      owner: userOwner,
      entry,
      sessionKey: "agent:main:main",
      cfg: {
        gateway: {
          multiUser: {
            mode: "strict",
            delegation: {
              enabled: true,
              rules: [
                {
                  fromUserId: userOwner.userId,
                  toUserId: "other-user",
                  resources: ["sessions"],
                },
              ],
            },
          },
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("allows admins to access any session", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: Date.now(),
      ownerUserId: "other-user",
    };
    const result = assertSessionAccess({
      owner: adminOwner,
      entry,
      sessionKey: "agent:main:main",
    });
    expect(result.ok).toBe(true);
  });

  it("allows missing owner metadata in compat mode", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: Date.now(),
    };
    const result = assertSessionAccess({
      owner: userOwner,
      entry,
      sessionKey: "agent:main:main",
      cfg: { gateway: { multiUser: { mode: "compat" } } },
    });
    expect(result.ok).toBe(true);
  });

  it("disables ownership checks in off mode", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: Date.now(),
      ownerUserId: "other-user",
    };
    const result = assertSessionAccess({
      owner: userOwner,
      entry,
      sessionKey: "agent:main:main",
      cfg: { gateway: { multiUser: { mode: "off" } } },
    });
    expect(result.ok).toBe(true);
  });
});

describe("session ownership helpers", () => {
  it("sessionOwnedByUser checks ownerUserId", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: Date.now(),
      ownerUserId: "user-a",
    };
    expect(sessionOwnedByUser(entry, "user-a")).toBe(true);
    expect(sessionOwnedByUser(entry, "user-b")).toBe(false);
  });

  it("stampSessionOwner stamps non-admin sessions", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: Date.now(),
    };
    const stamped = stampSessionOwner({ entry, owner: userOwner });
    expect(stamped.ownerUserId).toBe(userOwner.userId);
    expect(stamped.ownerPrincipalId).toBe(userOwner.principalId);
  });

  it("stampSessionOwner does not overwrite existing owner during delegated access", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: Date.now(),
      ownerUserId: "owner-user",
      ownerPrincipalId: "owner:principal",
    };
    const stamped = stampSessionOwner({ entry, owner: userOwner });
    expect(stamped.ownerUserId).toBe("owner-user");
    expect(stamped.ownerPrincipalId).toBe("owner:principal");
  });
});
