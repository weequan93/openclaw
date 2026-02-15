import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../../config/config.js";
import type { SlackMonitorContext } from "../context.js";
import { registerSlackChannelEvents } from "./channels.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  writeConfigFile: vi.fn(),
  migrateSlackChannelConfig: vi.fn(),
}));

vi.mock("../../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../../config/config.js")>("../../../config/config.js");
  return {
    ...actual,
    loadConfig: mocks.loadConfig,
    writeConfigFile: mocks.writeConfigFile,
  };
});

vi.mock("../../channel-migration.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../channel-migration.js")>("../../channel-migration.js");
  return {
    ...actual,
    migrateSlackChannelConfig: mocks.migrateSlackChannelConfig,
  };
});

function buildContext(cfg: OpenClawConfig) {
  const handlers = new Map<string, (args: unknown) => Promise<void>>();
  const runtimeLog = vi.fn();
  const runtimeError = vi.fn();

  const ctx = {
    cfg,
    accountId: "default",
    app: {
      event: (name: string, handler: (args: unknown) => Promise<void>) => {
        handlers.set(name, handler);
      },
    },
    runtime: {
      log: runtimeLog,
      error: runtimeError,
    },
    shouldDropMismatchedSlackEvent: () => false,
    resolveChannelName: async () => ({ name: "new-name" }),
  } as unknown as SlackMonitorContext;

  return { ctx, handlers, runtimeLog, runtimeError };
}

describe("registerSlackChannelEvents channel_id_changed migration guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeConfigFile.mockResolvedValue(undefined);
    mocks.loadConfig.mockReturnValue({
      channels: { slack: { channels: { COLD: { users: ["U1"] } } } },
    });
    mocks.migrateSlackChannelConfig.mockReturnValue({
      migrated: true,
      skippedExisting: false,
    });
  });

  it("blocks automatic config migration in strict multi-user mode", async () => {
    const { ctx, handlers, runtimeLog } = buildContext({
      gateway: { multiUser: { mode: "strict" } },
    } as OpenClawConfig);

    registerSlackChannelEvents({ ctx });
    const handler = handlers.get("channel_id_changed");
    expect(handler).toBeTruthy();

    await handler?.({
      event: { old_channel_id: "COLD", new_channel_id: "CNEW" },
      body: {},
    });

    expect(mocks.loadConfig).not.toHaveBeenCalled();
    expect(mocks.migrateSlackChannelConfig).not.toHaveBeenCalled();
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
    expect(runtimeLog).toHaveBeenCalledWith(
      expect.stringContaining("Multi-user mode blocks automatic config migration"),
    );
  });

  it("keeps migration behavior in off mode", async () => {
    const { ctx, handlers } = buildContext({
      gateway: { multiUser: { mode: "off" } },
    } as OpenClawConfig);

    registerSlackChannelEvents({ ctx });
    const handler = handlers.get("channel_id_changed");
    expect(handler).toBeTruthy();

    await handler?.({
      event: { old_channel_id: "COLD", new_channel_id: "CNEW" },
      body: {},
    });

    expect(mocks.loadConfig).toHaveBeenCalledTimes(1);
    expect(mocks.migrateSlackChannelConfig).toHaveBeenCalledTimes(2);
    expect(mocks.writeConfigFile).toHaveBeenCalledTimes(1);
  });
});
