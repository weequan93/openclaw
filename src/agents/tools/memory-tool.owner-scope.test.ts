import { describe, expect, it, vi } from "vitest";

vi.mock("../../memory/index.js", () => ({
  getMemorySearchManager: async () => ({
    manager: {
      search: async () => [],
      readFile: async () => ({ path: "MEMORY.md", text: "" }),
      status: () => ({
        files: 0,
        chunks: 0,
        dirty: false,
        workspaceDir: "/tmp",
        dbPath: "/tmp/index.sqlite",
        provider: "builtin",
        model: "builtin",
        requestedProvider: "builtin",
      }),
    },
  }),
}));

const resolveSessionOwnerUserIdMock = vi.fn();
vi.mock("../../memory/owner-partition.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../memory/owner-partition.js")>();
  return {
    ...actual,
    resolveSessionOwnerUserId: (...args: unknown[]) => resolveSessionOwnerUserIdMock(...args),
  };
});

import { createMemoryGetTool, createMemorySearchTool } from "./memory-tool.js";

describe("memory tools owner scope", () => {
  it("disables memory_search in strict mode when session owner is unresolved", () => {
    resolveSessionOwnerUserIdMock.mockReturnValueOnce(undefined);
    const cfg = {
      gateway: { multiUser: { mode: "strict" } },
      agents: { list: [{ id: "main", default: true }] },
    };

    const tool = createMemorySearchTool({
      config: cfg,
      agentSessionKey: "agent:main:discord:dm:u1",
    });
    expect(tool).toBeNull();
  });

  it("disables memory_get in strict mode when session owner is unresolved", () => {
    resolveSessionOwnerUserIdMock.mockReturnValueOnce(undefined);
    const cfg = {
      gateway: { multiUser: { mode: "strict" } },
      agents: { list: [{ id: "main", default: true }] },
    };

    const tool = createMemoryGetTool({
      config: cfg,
      agentSessionKey: "agent:main:discord:dm:u1",
    });
    expect(tool).toBeNull();
  });

  it("keeps memory_search enabled in strict mode when owner is resolved", () => {
    resolveSessionOwnerUserIdMock.mockReturnValueOnce("user-a");
    const cfg = {
      gateway: { multiUser: { mode: "strict" } },
      agents: { list: [{ id: "main", default: true }] },
    };

    const tool = createMemorySearchTool({
      config: cfg,
      agentSessionKey: "agent:main:discord:dm:u1",
    });
    expect(tool).not.toBeNull();
  });

  it("keeps memory_search enabled in compat mode when owner is unresolved", () => {
    resolveSessionOwnerUserIdMock.mockReturnValueOnce(undefined);
    const cfg = {
      gateway: { multiUser: { mode: "compat" } },
      agents: { list: [{ id: "main", default: true }] },
    };

    const tool = createMemorySearchTool({
      config: cfg,
      agentSessionKey: "agent:main:discord:dm:u1",
    });
    expect(tool).not.toBeNull();
  });
});
