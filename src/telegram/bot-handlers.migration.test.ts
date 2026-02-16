import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { registerTelegramHandlers } from "./bot-handlers.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  writeConfigFile: vi.fn(),
  migrateTelegramGroupConfig: vi.fn(),
}));

vi.mock("../config/config.js", async () => {
  const actual = await vi.importActual<typeof import("../config/config.js")>("../config/config.js");
  return {
    ...actual,
    loadConfig: mocks.loadConfig,
  };
});

vi.mock("../config/io.js", async () => {
  const actual = await vi.importActual<typeof import("../config/io.js")>("../config/io.js");
  return {
    ...actual,
    writeConfigFile: mocks.writeConfigFile,
  };
});

vi.mock("./group-migration.js", async () => {
  const actual =
    await vi.importActual<typeof import("./group-migration.js")>("./group-migration.js");
  return {
    ...actual,
    migrateTelegramGroupConfig: mocks.migrateTelegramGroupConfig,
  };
});

function buildHarness(cfg: OpenClawConfig) {
  const handlers = new Map<string, (ctx: unknown) => Promise<void>>();
  const runtimeLog = vi.fn();
  const runtimeError = vi.fn();

  const bot = {
    api: {},
    on: (event: string, handler: (ctx: unknown) => Promise<void>) => {
      handlers.set(event, handler);
    },
  };

  registerTelegramHandlers({
    cfg,
    accountId: "default",
    bot: bot as never,
    opts: { token: "t" } as never,
    runtime: { log: runtimeLog, error: runtimeError } as never,
    mediaMaxBytes: 5_000_000,
    telegramCfg: {} as never,
    groupAllowFrom: [],
    resolveGroupPolicy: () => "open" as never,
    resolveTelegramGroupConfig: () => ({}),
    shouldSkipUpdate: () => false,
    processMessage: async () => undefined,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
  });

  const migrateHandler = handlers.get("message:migrate_to_chat_id");
  if (!migrateHandler) {
    throw new Error("message:migrate_to_chat_id handler not registered");
  }

  return { migrateHandler, runtimeLog, runtimeError };
}

describe("telegram group migration guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeConfigFile.mockResolvedValue(undefined);
    mocks.loadConfig.mockReturnValue({
      channels: {
        telegram: {
          groups: {
            "-1001": { enabled: true },
          },
        },
      },
    });
    mocks.migrateTelegramGroupConfig.mockReturnValue({
      migrated: true,
      skippedExisting: false,
    });
  });

  it("blocks automatic config migration in strict multi-user mode", async () => {
    const { migrateHandler, runtimeLog } = buildHarness({
      gateway: { multiUser: { mode: "strict" } },
    } as OpenClawConfig);

    await migrateHandler({
      message: {
        migrate_to_chat_id: -1002,
        chat: { id: -1001, title: "Test Group" },
      },
    });

    expect(mocks.loadConfig).not.toHaveBeenCalled();
    expect(mocks.migrateTelegramGroupConfig).not.toHaveBeenCalled();
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
    expect(runtimeLog).toHaveBeenCalledWith(
      expect.stringContaining("Multi-user mode blocks automatic config migration"),
    );
  });

  it("keeps migration behavior in off mode", async () => {
    const { migrateHandler } = buildHarness({
      gateway: { multiUser: { mode: "off" } },
    } as OpenClawConfig);

    await migrateHandler({
      message: {
        migrate_to_chat_id: -1002,
        chat: { id: -1001, title: "Test Group" },
      },
    });

    expect(mocks.loadConfig).toHaveBeenCalledTimes(1);
    expect(mocks.migrateTelegramGroupConfig).toHaveBeenCalledTimes(2);
    expect(mocks.writeConfigFile).toHaveBeenCalledTimes(1);
  });
});
