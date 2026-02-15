import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSessionStore: vi.fn(() => ({})),
  resolveGatewaySessionStoreTarget: vi.fn(() => ({
    storePath: "/tmp/sessions.json",
    storeKeys: ["agent:main:target"],
    canonicalKey: "agent:main:target",
  })),
  loadCombinedSessionStoreForGateway: vi.fn(() => ({
    storePath: "/tmp/sessions.json",
    store: {},
  })),
  listSessionsFromStore: vi.fn(() => ({ sessions: [] })),
}));

vi.mock("../config/sessions.js", async () => {
  const actual =
    await vi.importActual<typeof import("../config/sessions.js")>("../config/sessions.js");
  return {
    ...actual,
    loadSessionStore: mocks.loadSessionStore,
  };
});

vi.mock("./session-utils.js", async () => {
  const actual = await vi.importActual<typeof import("./session-utils.js")>("./session-utils.js");
  return {
    ...actual,
    resolveGatewaySessionStoreTarget: mocks.resolveGatewaySessionStoreTarget,
    loadCombinedSessionStoreForGateway: mocks.loadCombinedSessionStoreForGateway,
    listSessionsFromStore: mocks.listSessionsFromStore,
  };
});

import { resolveSessionKeyFromResolveParams } from "./sessions-resolve.js";

describe("resolveSessionKeyFromResolveParams delegation", () => {
  it("allows key resolution when sessions delegation grants cross-owner access", () => {
    mocks.loadSessionStore.mockReturnValueOnce({
      "agent:main:target": {
        ownerUserId: "user-b",
      },
    });
    const result = resolveSessionKeyFromResolveParams({
      cfg: {
        gateway: {
          multiUser: {
            mode: "strict",
            delegation: {
              enabled: true,
              rules: [
                {
                  fromUserId: "user-a",
                  toUserId: "user-b",
                  resources: ["sessions"],
                },
              ],
            },
          },
        },
      },
      p: { key: "target" },
      ownerUserId: "user-a",
    });

    expect(result).toEqual({ ok: true, key: "agent:main:target" });
  });

  it("denies key resolution for cross-owner access without delegation", () => {
    mocks.loadSessionStore.mockReturnValueOnce({
      "agent:main:target": {
        ownerUserId: "user-b",
      },
    });
    const result = resolveSessionKeyFromResolveParams({
      cfg: { gateway: { multiUser: { mode: "strict" } } },
      p: { key: "target" },
      ownerUserId: "user-a",
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { message: string } }).error.message).toBe(
      "No session found: target",
    );
  });

  it("allows sessionId resolution when sessions delegation grants cross-owner access", () => {
    mocks.listSessionsFromStore.mockReturnValueOnce({
      sessions: [
        {
          key: "agent:main:target",
          sessionId: "sess-1",
          ownerUserId: "user-b",
        },
      ],
    });
    const result = resolveSessionKeyFromResolveParams({
      cfg: {
        gateway: {
          multiUser: {
            mode: "strict",
            delegation: {
              enabled: true,
              rules: [
                {
                  fromUserId: "user-a",
                  toUserId: "user-b",
                  resources: ["sessions"],
                },
              ],
            },
          },
        },
      },
      p: { sessionId: "sess-1" },
      ownerUserId: "user-a",
    });

    expect(result).toEqual({ ok: true, key: "agent:main:target" });
    const listCall = mocks.listSessionsFromStore.mock.calls.at(-1)?.[0] as
      | { opts?: { ownerUserId?: string } }
      | undefined;
    expect(listCall?.opts?.ownerUserId).toBeUndefined();
  });
});
