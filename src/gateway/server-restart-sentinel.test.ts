import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveAnnounceTargetFromKeyMock = vi.fn();
const normalizeChannelIdMock = vi.fn();
const agentCommandMock = vi.fn();
const resolveMainSessionKeyFromConfigMock = vi.fn();
const resolveOutboundTargetMock = vi.fn();
const consumeRestartSentinelMock = vi.fn();
const formatRestartSentinelMessageMock = vi.fn();
const summarizeRestartSentinelMock = vi.fn();
const enqueueSystemEventMock = vi.fn();
const loadSessionEntryMock = vi.fn();

vi.mock("../agents/tools/sessions-send-helpers.js", () => ({
  resolveAnnounceTargetFromKey: (sessionKey: string) =>
    resolveAnnounceTargetFromKeyMock(sessionKey),
}));

vi.mock("../channels/plugins/index.js", () => ({
  normalizeChannelId: (channel: string) => normalizeChannelIdMock(channel),
}));

vi.mock("../commands/agent.js", () => ({
  agentCommand: (...args: unknown[]) => agentCommandMock(...args),
}));

vi.mock("../config/sessions.js", () => ({
  resolveMainSessionKeyFromConfig: () => resolveMainSessionKeyFromConfigMock(),
}));

vi.mock("../infra/outbound/targets.js", () => ({
  resolveOutboundTarget: (params: unknown) => resolveOutboundTargetMock(params),
}));

vi.mock("../infra/restart-sentinel.js", () => ({
  consumeRestartSentinel: () => consumeRestartSentinelMock(),
  formatRestartSentinelMessage: (payload: unknown) => formatRestartSentinelMessageMock(payload),
  summarizeRestartSentinel: (payload: unknown) => summarizeRestartSentinelMock(payload),
}));

vi.mock("../infra/system-events.js", () => ({
  enqueueSystemEvent: (...args: unknown[]) => enqueueSystemEventMock(...args),
}));

vi.mock("./session-utils.js", () => ({
  loadSessionEntry: (...args: unknown[]) => loadSessionEntryMock(...args),
}));

import { scheduleRestartSentinelWake } from "./server-restart-sentinel.js";

describe("scheduleRestartSentinelWake", () => {
  beforeEach(() => {
    resolveAnnounceTargetFromKeyMock.mockReset();
    normalizeChannelIdMock.mockReset();
    agentCommandMock.mockReset();
    resolveMainSessionKeyFromConfigMock.mockReset();
    resolveOutboundTargetMock.mockReset();
    consumeRestartSentinelMock.mockReset();
    formatRestartSentinelMessageMock.mockReset();
    summarizeRestartSentinelMock.mockReset();
    enqueueSystemEventMock.mockReset();
    loadSessionEntryMock.mockReset();

    resolveAnnounceTargetFromKeyMock.mockReturnValue(undefined);
    normalizeChannelIdMock.mockImplementation((value: string) => value);
    agentCommandMock.mockResolvedValue(undefined);
    resolveMainSessionKeyFromConfigMock.mockReturnValue("agent:main:main");
    resolveOutboundTargetMock.mockReturnValue({ ok: true, to: "resolved-target" });
    consumeRestartSentinelMock.mockResolvedValue(null);
    formatRestartSentinelMessageMock.mockReturnValue("GatewayRestart");
    summarizeRestartSentinelMock.mockReturnValue("Gateway restart summary");
    loadSessionEntryMock.mockReturnValue({ cfg: {}, entry: undefined });
  });

  it("uses owner-scoped session lookup when sentinel includes ownerUserId", async () => {
    consumeRestartSentinelMock.mockResolvedValue({
      version: 1,
      payload: {
        kind: "restart",
        status: "ok",
        ts: Date.now(),
        sessionKey: "agent:main:telegram:dm:user-1:thread:abc",
        ownerUserId: "owner-1",
      },
    });
    loadSessionEntryMock
      .mockReturnValueOnce({ cfg: {}, entry: { sessionId: "s-thread" } })
      .mockReturnValueOnce({
        cfg: {},
        entry: {
          sessionId: "s-base",
          deliveryContext: {
            channel: "telegram",
            to: "user-1",
            accountId: "acct-1",
          },
        },
      });

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(loadSessionEntryMock).toHaveBeenNthCalledWith(
      1,
      "agent:main:telegram:dm:user-1:thread:abc",
      { ownerUserId: "owner-1" },
    );
    expect(loadSessionEntryMock).toHaveBeenNthCalledWith(2, "agent:main:telegram:dm:user-1", {
      ownerUserId: "owner-1",
    });
    expect(agentCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:telegram:dm:user-1:thread:abc",
        channel: "telegram",
        to: "resolved-target",
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("passes undefined owner scope when sentinel has no ownerUserId", async () => {
    consumeRestartSentinelMock.mockResolvedValue({
      version: 1,
      payload: {
        kind: "restart",
        status: "ok",
        ts: Date.now(),
        sessionKey: "agent:main:telegram:dm:user-2",
      },
    });
    loadSessionEntryMock.mockReturnValue({
      cfg: {},
      entry: {
        sessionId: "s-base",
        deliveryContext: {
          channel: "telegram",
          to: "user-2",
          accountId: "acct-2",
        },
      },
    });

    await scheduleRestartSentinelWake({ deps: {} as never });

    expect(loadSessionEntryMock).toHaveBeenCalledWith("agent:main:telegram:dm:user-2", {
      ownerUserId: undefined,
    });
    expect(agentCommandMock).toHaveBeenCalled();
  });
});
