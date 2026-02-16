import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "./openclaw-tools.js";
import { createGatewayTool } from "./tools/gateway-tool.js";

vi.mock("./tools/gateway.js", () => ({
  callGatewayTool: vi.fn(async (method: string) => {
    if (method === "config.get") {
      return { hash: "hash-1" };
    }
    return { ok: true };
  }),
}));

vi.mock("../gateway/session-utils.js", () => ({
  loadSessionEntry: vi.fn(() => ({ entry: undefined })),
}));

describe("gateway tool", () => {
  beforeEach(async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    const { loadSessionEntry } = await import("../gateway/session-utils.js");
    vi.mocked(callGatewayTool).mockClear();
    vi.mocked(loadSessionEntry).mockClear();
  });

  it("schedules SIGUSR1 restart", async () => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    const previousProfile = process.env.OPENCLAW_PROFILE;
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-test-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.OPENCLAW_PROFILE = "isolated";

    try {
      const tool = createOpenClawTools({
        config: { commands: { restart: true } },
      }).find((candidate) => candidate.name === "gateway");
      expect(tool).toBeDefined();
      if (!tool) {
        throw new Error("missing gateway tool");
      }

      const result = await tool.execute("call1", {
        action: "restart",
        delayMs: 0,
      });
      expect(result.details).toMatchObject({
        ok: true,
        pid: process.pid,
        signal: "SIGUSR1",
        delayMs: 0,
      });

      const sentinelPath = path.join(stateDir, "restart-sentinel.json");
      const raw = await fs.readFile(sentinelPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        payload?: { kind?: string; doctorHint?: string | null };
      };
      expect(parsed.payload?.kind).toBe("restart");
      expect(parsed.payload?.doctorHint).toBe(
        "Run: openclaw --profile isolated doctor --non-interactive",
      );

      expect(kill).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(kill).toHaveBeenCalledWith(process.pid, "SIGUSR1");
    } finally {
      kill.mockRestore();
      vi.useRealTimers();
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
      if (previousProfile === undefined) {
        delete process.env.OPENCLAW_PROFILE;
      } else {
        process.env.OPENCLAW_PROFILE = previousProfile;
      }
    }
  });

  it("passes config.apply through gateway call", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    const tool = createOpenClawTools({
      agentSessionKey: "agent:main:whatsapp:dm:+15555550123",
    }).find((candidate) => candidate.name === "gateway");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing gateway tool");
    }

    const raw = '{\n  agents: { defaults: { workspace: "~/openclaw" } }\n}\n';
    await tool.execute("call2", {
      action: "config.apply",
      raw,
    });

    expect(callGatewayTool).toHaveBeenCalledWith(
      "config.get",
      expect.any(Object),
      {},
      expect.objectContaining({ allowAdmin: true }),
    );
    expect(callGatewayTool).toHaveBeenCalledWith(
      "config.apply",
      expect.any(Object),
      expect.objectContaining({
        raw: raw.trim(),
        baseHash: "hash-1",
        sessionKey: "agent:main:whatsapp:dm:+15555550123",
      }),
      expect.objectContaining({ allowAdmin: true }),
    );
  });

  it("passes config.patch through gateway call", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    const tool = createOpenClawTools({
      agentSessionKey: "agent:main:whatsapp:dm:+15555550123",
    }).find((candidate) => candidate.name === "gateway");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing gateway tool");
    }

    const raw = '{\n  channels: { telegram: { groups: { "*": { requireMention: false } } } }\n}\n';
    await tool.execute("call4", {
      action: "config.patch",
      raw,
    });

    expect(callGatewayTool).toHaveBeenCalledWith(
      "config.get",
      expect.any(Object),
      {},
      expect.objectContaining({ allowAdmin: true }),
    );
    expect(callGatewayTool).toHaveBeenCalledWith(
      "config.patch",
      expect.any(Object),
      expect.objectContaining({
        raw: raw.trim(),
        baseHash: "hash-1",
        sessionKey: "agent:main:whatsapp:dm:+15555550123",
      }),
      expect.objectContaining({ allowAdmin: true }),
    );
  });

  it("passes update.run through gateway call", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    const tool = createOpenClawTools({
      agentSessionKey: "agent:main:whatsapp:dm:+15555550123",
    }).find((candidate) => candidate.name === "gateway");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing gateway tool");
    }

    await tool.execute("call3", {
      action: "update.run",
      note: "test update",
    });

    expect(callGatewayTool).toHaveBeenCalledWith(
      "update.run",
      expect.any(Object),
      expect.objectContaining({
        note: "test update",
        sessionKey: "agent:main:whatsapp:dm:+15555550123",
      }),
      expect.objectContaining({ allowAdmin: true }),
    );
    const updateCall = vi
      .mocked(callGatewayTool)
      .mock.calls.find((call) => call[0] === "update.run");
    expect(updateCall).toBeDefined();
    if (updateCall) {
      const [, opts, params] = updateCall;
      expect(opts).toMatchObject({ timeoutMs: 20 * 60_000 });
      expect(params).toMatchObject({ timeoutMs: 20 * 60_000 });
    }
  });

  it("hides gateway tool for non-admin owner-bound runs in multi-user mode", () => {
    const tools = createOpenClawTools({
      config: { gateway: { multiUser: { mode: "strict" } } },
      ownerUserId: "user-1",
      ownerRole: "user",
    });
    expect(tools.some((candidate) => candidate.name === "gateway")).toBe(false);
    expect(tools.some((candidate) => candidate.name === "cron")).toBe(false);
  });

  it("denies direct gateway tool execution for non-admin owner-bound runs", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    const tool = createGatewayTool({
      config: { gateway: { multiUser: { mode: "strict" } } },
      ownerUserId: "user-1",
      ownerRole: "user",
    });
    await expect(
      tool.execute("call-user-denied", {
        action: "config.get",
      }),
    ).rejects.toThrow("admin-only");
    expect(callGatewayTool).not.toHaveBeenCalled();
  });

  it("allows admin owner-bound runs in multi-user mode", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    const tool = createOpenClawTools({
      config: { gateway: { multiUser: { mode: "strict" } } },
      ownerUserId: "admin-1",
      ownerRole: "admin",
    }).find((candidate) => candidate.name === "gateway");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing gateway tool");
    }

    await tool.execute("call-admin-allowed", {
      action: "config.get",
    });
    expect(callGatewayTool).toHaveBeenCalledWith(
      "config.get",
      expect.any(Object),
      {},
      expect.objectContaining({ allowAdmin: true }),
    );
  });

  it("keeps cron and gateway tools visible for admin owner-bound runs", () => {
    const tools = createOpenClawTools({
      config: { gateway: { multiUser: { mode: "strict" } } },
      ownerUserId: "admin-1",
      ownerRole: "admin",
    });
    expect(tools.some((candidate) => candidate.name === "gateway")).toBe(true);
    expect(tools.some((candidate) => candidate.name === "cron")).toBe(true);
  });

  it("uses owner-scoped session lookup for restart sentinel delivery context", async () => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    const previousProfile = process.env.OPENCLAW_PROFILE;
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-test-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.OPENCLAW_PROFILE = "isolated";
    const { loadSessionEntry } = await import("../gateway/session-utils.js");
    vi.mocked(loadSessionEntry).mockReturnValue({
      entry: {
        sessionId: "session-1",
        deliveryContext: {
          channel: "telegram",
          to: "user-1",
          accountId: "acct-1",
        },
      },
    });

    try {
      const tool = createGatewayTool({
        config: { commands: { restart: true } },
        ownerUserId: "owner-1",
        ownerRole: "admin",
        agentSessionKey: "agent:main:telegram:dm:user-1",
      });
      await tool.execute("call-owner-restart", {
        action: "restart",
        delayMs: 0,
      });
      expect(loadSessionEntry).toHaveBeenCalledWith("agent:main:telegram:dm:user-1", {
        ownerUserId: "owner-1",
      });

      const sentinelPath = path.join(stateDir, "restart-sentinel.json");
      const raw = await fs.readFile(sentinelPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        payload?: { ownerUserId?: string; deliveryContext?: unknown };
      };
      expect(parsed.payload?.ownerUserId).toBe("owner-1");
      expect(parsed.payload?.deliveryContext).toEqual({
        channel: "telegram",
        to: "user-1",
        accountId: "acct-1",
      });

      await vi.runAllTimersAsync();
    } finally {
      kill.mockRestore();
      vi.useRealTimers();
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
      if (previousProfile === undefined) {
        delete process.env.OPENCLAW_PROFILE;
      } else {
        process.env.OPENCLAW_PROFILE = previousProfile;
      }
    }
  });

  it("falls back to base session for thread restart sentinel delivery context", async () => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    const previousProfile = process.env.OPENCLAW_PROFILE;
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-test-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.OPENCLAW_PROFILE = "isolated";
    const { loadSessionEntry } = await import("../gateway/session-utils.js");
    vi.mocked(loadSessionEntry)
      .mockReturnValueOnce({ entry: { sessionId: "thread-1" } })
      .mockReturnValueOnce({
        entry: {
          sessionId: "base-1",
          deliveryContext: {
            channel: "slack",
            to: "U1",
            accountId: "acct-2",
          },
        },
      });

    try {
      const tool = createGatewayTool({
        config: { commands: { restart: true } },
        ownerUserId: "owner-2",
        ownerRole: "admin",
        agentSessionKey: "agent:main:slack:dm:U1:thread:thread-abc",
      });
      await tool.execute("call-thread-restart", {
        action: "restart",
        delayMs: 0,
      });

      expect(loadSessionEntry).toHaveBeenNthCalledWith(
        1,
        "agent:main:slack:dm:U1:thread:thread-abc",
        { ownerUserId: "owner-2" },
      );
      expect(loadSessionEntry).toHaveBeenNthCalledWith(2, "agent:main:slack:dm:U1", {
        ownerUserId: "owner-2",
      });

      const sentinelPath = path.join(stateDir, "restart-sentinel.json");
      const raw = await fs.readFile(sentinelPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        payload?: { ownerUserId?: string; deliveryContext?: unknown; threadId?: string };
      };
      expect(parsed.payload?.ownerUserId).toBe("owner-2");
      expect(parsed.payload?.threadId).toBe("thread-abc");
      expect(parsed.payload?.deliveryContext).toEqual({
        channel: "slack",
        to: "U1",
        accountId: "acct-2",
      });

      await vi.runAllTimersAsync();
    } finally {
      kill.mockRestore();
      vi.useRealTimers();
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
      if (previousProfile === undefined) {
        delete process.env.OPENCLAW_PROFILE;
      } else {
        process.env.OPENCLAW_PROFILE = previousProfile;
      }
    }
  });
});
