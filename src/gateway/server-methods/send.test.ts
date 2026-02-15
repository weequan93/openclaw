import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "./types.js";
import { sendHandlers } from "./send.js";

const mocks = vi.hoisted(() => ({
  deliverOutboundPayloads: vi.fn(),
  appendAssistantMessageToSessionTranscript: vi.fn(async () => ({ ok: true, sessionFile: "x" })),
  recordSessionMetaFromInbound: vi.fn(async () => ({ ok: true })),
  updateSessionStore: vi.fn(async () => undefined),
  loadSessionEntry: vi.fn((sessionKey?: string) => ({
    entry: undefined,
    canonicalKey: sessionKey ?? "agent:main:main",
    storePath: "/tmp/sessions.json",
  })),
  assertSessionAccess: vi.fn(() => ({ ok: true })),
}));

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    loadConfig: () => ({}),
  };
});

vi.mock("../../channels/plugins/index.js", () => ({
  getChannelPlugin: () => ({ outbound: {} }),
  normalizeChannelId: (value: string) => value,
}));

vi.mock("../../infra/outbound/targets.js", () => ({
  resolveOutboundTarget: () => ({ ok: true, to: "resolved" }),
}));

vi.mock("../../infra/outbound/deliver.js", () => ({
  deliverOutboundPayloads: mocks.deliverOutboundPayloads,
}));

vi.mock("../../config/sessions.js", async () => {
  const actual = await vi.importActual<typeof import("../../config/sessions.js")>(
    "../../config/sessions.js",
  );
  return {
    ...actual,
    appendAssistantMessageToSessionTranscript: mocks.appendAssistantMessageToSessionTranscript,
    recordSessionMetaFromInbound: mocks.recordSessionMetaFromInbound,
    updateSessionStore: (...args: unknown[]) => mocks.updateSessionStore(...args),
  };
});

vi.mock("../session-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../session-utils.js")>("../session-utils.js");
  return {
    ...actual,
    loadSessionEntry: (...args: unknown[]) => mocks.loadSessionEntry(...args),
  };
});

vi.mock("../session-owner.js", async () => {
  const actual = await vi.importActual<typeof import("../session-owner.js")>("../session-owner.js");
  return {
    ...actual,
    assertSessionAccess: (...args: unknown[]) => mocks.assertSessionAccess(...args),
  };
});

const makeContext = (): GatewayRequestContext =>
  ({
    dedupe: new Map(),
  }) as unknown as GatewayRequestContext;

describe("gateway send mirroring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadSessionEntry.mockImplementation((sessionKey?: string) => ({
      entry: undefined,
      canonicalKey: sessionKey ?? "agent:main:main",
      storePath: "/tmp/sessions.json",
    }));
    mocks.assertSessionAccess.mockReturnValue({ ok: true });
  });

  const userOwner = {
    userId: "user-a",
    principalId: "msg:discord:default:user-a",
    role: "user" as const,
    sourceRole: "operator" as const,
    scopes: ["operator.write"],
  };

  it("does not mirror when delivery returns no results", async () => {
    mocks.deliverOutboundPayloads.mockResolvedValue([]);

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "channel:C1",
        message: "hi",
        channel: "slack",
        idempotencyKey: "idem-1",
        sessionKey: "agent:main:main",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        mirror: expect.objectContaining({
          sessionKey: "agent:main:main",
        }),
      }),
    );
  });

  it("mirrors media filenames when delivery succeeds", async () => {
    mocks.deliverOutboundPayloads.mockResolvedValue([{ messageId: "m1", channel: "slack" }]);

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "channel:C1",
        message: "caption",
        mediaUrl: "https://example.com/files/report.pdf?sig=1",
        channel: "slack",
        idempotencyKey: "idem-2",
        sessionKey: "agent:main:main",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        mirror: expect.objectContaining({
          sessionKey: "agent:main:main",
          text: "caption",
          mediaUrls: ["https://example.com/files/report.pdf?sig=1"],
        }),
      }),
    );
  });

  it("mirrors MEDIA tags as attachments", async () => {
    mocks.deliverOutboundPayloads.mockResolvedValue([{ messageId: "m2", channel: "slack" }]);

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "channel:C1",
        message: "Here\nMEDIA:https://example.com/image.png",
        channel: "slack",
        idempotencyKey: "idem-3",
        sessionKey: "agent:main:main",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        mirror: expect.objectContaining({
          sessionKey: "agent:main:main",
          text: "Here",
          mediaUrls: ["https://example.com/image.png"],
        }),
      }),
    );
  });

  it("lowercases provided session keys for mirroring", async () => {
    mocks.deliverOutboundPayloads.mockResolvedValue([{ messageId: "m-lower", channel: "slack" }]);

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "channel:C1",
        message: "hi",
        channel: "slack",
        idempotencyKey: "idem-lower",
        sessionKey: "agent:main:slack:channel:C123",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        mirror: expect.objectContaining({
          sessionKey: "agent:main:slack:channel:c123",
        }),
      }),
    );
  });

  it("derives a target session key when none is provided", async () => {
    mocks.deliverOutboundPayloads.mockResolvedValue([{ messageId: "m3", channel: "slack" }]);

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "channel:C1",
        message: "hello",
        channel: "slack",
        idempotencyKey: "idem-4",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.recordSessionMetaFromInbound).toHaveBeenCalled();
    expect(mocks.deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        mirror: expect.objectContaining({
          sessionKey: "agent:main:slack:channel:resolved",
          agentId: "main",
        }),
      }),
    );
  });

  it("denies mirroring to a provided session key when owner access fails", async () => {
    mocks.assertSessionAccess.mockReturnValueOnce({
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "session owner mismatch for key: agent:main:other",
        details: { reasonCode: "OWNER_MISMATCH" },
      },
    });
    mocks.loadSessionEntry.mockReturnValueOnce({
      entry: { ownerUserId: "user-b" },
      canonicalKey: "agent:main:other",
      storePath: "/tmp/sessions.json",
    });

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "channel:C1",
        message: "hi",
        channel: "slack",
        idempotencyKey: "idem-owner-deny",
        sessionKey: "agent:main:other",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      owner: userOwner,
      isWebchatConnect: () => false,
    });

    expect(mocks.deliverOutboundPayloads).not.toHaveBeenCalled();
    const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
    expect(ok).toBe(false);
    expect(payload).toBeUndefined();
    expect(error?.message ?? "").toContain("owner mismatch");
  });

  it("denies derived route mirroring when target session owner access fails", async () => {
    mocks.assertSessionAccess.mockReturnValueOnce({
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "session owner mismatch for key: agent:main:slack:channel:resolved",
        details: { reasonCode: "OWNER_MISMATCH" },
      },
    });
    mocks.loadSessionEntry.mockReturnValueOnce({
      entry: { ownerUserId: "user-b" },
      canonicalKey: "agent:main:slack:channel:resolved",
      storePath: "/tmp/sessions.json",
    });

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "channel:C1",
        message: "hello",
        channel: "slack",
        idempotencyKey: "idem-derived-owner-deny",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      owner: userOwner,
      isWebchatConnect: () => false,
    });

    expect(mocks.deliverOutboundPayloads).not.toHaveBeenCalled();
    const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
    expect(ok).toBe(false);
    expect(payload).toBeUndefined();
    expect(error?.message ?? "").toContain("owner mismatch");
  });

  it("stamps owner on explicit session mirroring for owner-restricted callers", async () => {
    mocks.deliverOutboundPayloads.mockResolvedValue([{ messageId: "m-owner-explicit", channel: "slack" }]);
    mocks.loadSessionEntry.mockReturnValueOnce({
      entry: { sessionId: "sess-explicit" },
      canonicalKey: "agent:main:main",
      storePath: "/tmp/sessions.json",
    });

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "channel:C1",
        message: "hello",
        channel: "slack",
        idempotencyKey: "idem-owner-explicit-stamp",
        sessionKey: "agent:main:main",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      owner: userOwner,
      isWebchatConnect: () => false,
    });

    expect(mocks.updateSessionStore).toHaveBeenCalledTimes(1);
    const [storePath, updater] = mocks.updateSessionStore.mock.calls[0] as [
      string,
      (store: Record<string, unknown>) => void | Promise<void>,
    ];
    expect(storePath).toBe("/tmp/sessions.json");
    const store = {
      "agent:main:main": { sessionId: "sess-explicit" },
    } as Record<string, unknown>;
    await updater(store);
    const stamped = store["agent:main:main"] as
      | { ownerUserId?: string; ownerPrincipalId?: string }
      | undefined;
    expect(stamped?.ownerUserId).toBe("user-a");
    expect(stamped?.ownerPrincipalId).toBe("msg:discord:default:user-a");
  });

  it("stamps owner on derived route mirroring for owner-restricted callers", async () => {
    mocks.deliverOutboundPayloads.mockResolvedValue([{ messageId: "m-owner-derived", channel: "slack" }]);
    mocks.loadSessionEntry.mockReturnValueOnce({
      entry: { sessionId: "sess-derived" },
      canonicalKey: "agent:main:slack:channel:resolved",
      storePath: "/tmp/sessions.json",
    });

    const respond = vi.fn();
    await sendHandlers.send({
      params: {
        to: "channel:C1",
        message: "hello",
        channel: "slack",
        idempotencyKey: "idem-owner-derived-stamp",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "send" },
      client: null,
      owner: userOwner,
      isWebchatConnect: () => false,
    });

    expect(mocks.updateSessionStore).toHaveBeenCalledTimes(1);
    const [storePath, updater] = mocks.updateSessionStore.mock.calls[0] as [
      string,
      (store: Record<string, unknown>) => void | Promise<void>,
    ];
    expect(storePath).toBe("/tmp/sessions.json");
    const store = {
      "agent:main:slack:channel:resolved": { sessionId: "sess-derived" },
    } as Record<string, unknown>;
    await updater(store);
    const stamped = store["agent:main:slack:channel:resolved"] as
      | { ownerUserId?: string; ownerPrincipalId?: string }
      | undefined;
    expect(stamped?.ownerUserId).toBe("user-a");
    expect(stamped?.ownerPrincipalId).toBe("msg:discord:default:user-a");
  });
});
