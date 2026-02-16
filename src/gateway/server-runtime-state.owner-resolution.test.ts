import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const loadSessionEntryMock = vi.fn();

vi.mock("./session-utils.js", () => ({
  loadSessionEntry: (...args: unknown[]) => loadSessionEntryMock(...args),
}));

import { resolveSessionOwnerUserIdForFanout } from "./server-runtime-state.js";

function asConfig(value: unknown): OpenClawConfig {
  return value as OpenClawConfig;
}

describe("resolveSessionOwnerUserIdForFanout", () => {
  beforeEach(() => {
    loadSessionEntryMock.mockReset();
    loadSessionEntryMock.mockReturnValue({ entry: undefined });
  });

  it("uses unscoped lookup for non-partitioned session stores", () => {
    loadSessionEntryMock.mockReturnValue({ entry: { ownerUserId: "user-shared" } });

    const ownerUserId = resolveSessionOwnerUserIdForFanout({
      sessionKey: "agent:main:main",
      cfg: asConfig({
        session: {
          store: "sessions.json",
        },
      }),
    });

    expect(ownerUserId).toBe("user-shared");
    expect(loadSessionEntryMock).toHaveBeenCalledWith("agent:main:main");
  });

  it("uses owner-scoped lookups only for owner-partitioned stores", () => {
    loadSessionEntryMock.mockImplementation(
      (_sessionKey: string, opts?: { ownerUserId?: string }) => {
        if (opts?.ownerUserId === "user-b") {
          return { entry: { ownerUserId: "user-b" } };
        }
        return { entry: undefined };
      },
    );

    const ownerUserId = resolveSessionOwnerUserIdForFanout({
      sessionKey: "agent:main:main",
      cfg: asConfig({
        session: {
          store: "sessions/{ownerUserId}.json",
        },
        gateway: {
          multiUser: {
            identities: {
              "principal:a": { userId: "user-a" },
              "principal:b": { userId: "user-b" },
            },
          },
        },
      }),
    });

    expect(ownerUserId).toBe("user-b");
    expect(loadSessionEntryMock).toHaveBeenCalledWith("agent:main:main", {
      ownerUserId: "user-a",
    });
    expect(loadSessionEntryMock).toHaveBeenCalledWith("agent:main:main", {
      ownerUserId: "user-b",
    });
    const usedUnscopedLookup = loadSessionEntryMock.mock.calls.some(
      (call) => call.length < 2 || call[1] === undefined,
    );
    expect(usedUnscopedLookup).toBe(false);
  });

  it("returns undefined when owner-partitioned lookups find no owner", () => {
    const ownerUserId = resolveSessionOwnerUserIdForFanout({
      sessionKey: "agent:main:main",
      cfg: asConfig({
        session: {
          store: "sessions/{ownerUserId}.json",
        },
        gateway: {
          multiUser: {
            identities: {
              "principal:a": { userId: "user-a" },
            },
          },
        },
      }),
    });

    expect(ownerUserId).toBeUndefined();
    expect(loadSessionEntryMock).toHaveBeenCalledWith("agent:main:main", {
      ownerUserId: "user-a",
    });
    const usedUnscopedLookup = loadSessionEntryMock.mock.calls.some(
      (call) => call.length < 2 || call[1] === undefined,
    );
    expect(usedUnscopedLookup).toBe(false);
  });
});
