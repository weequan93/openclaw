import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import type { ChannelPlugin } from "../channels/plugins/types.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { emitAgentEvent, registerAgentRunContext } from "../infra/agent-events.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import {
  agentCommand,
  connectOk,
  getFreePort,
  installGatewayTestHooks,
  onceMessage,
  rpcReq,
  startGatewayServer,
  startServerWithClient,
  testState,
  writeSessionStore,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startServerWithClient>>["server"];
let ws: Awaited<ReturnType<typeof startServerWithClient>>["ws"];
let port: number;

beforeAll(async () => {
  const started = await startServerWithClient();
  server = started.server;
  ws = started.ws;
  port = started.port;
  await connectOk(ws);
});

afterAll(async () => {
  ws.close();
  await server.close();
});

const registryState = vi.hoisted(() => ({
  registry: {
    plugins: [],
    tools: [],
    channels: [],
    providers: [],
    gatewayHandlers: {},
    httpHandlers: [],
    httpRoutes: [],
    cliRegistrars: [],
    services: [],
    diagnostics: [],
  } as PluginRegistry,
}));

vi.mock("./server-plugins.js", async () => {
  const { setActivePluginRegistry } = await import("../plugins/runtime.js");
  return {
    loadGatewayPlugins: (params: { baseMethods: string[] }) => {
      setActivePluginRegistry(registryState.registry);
      return {
        pluginRegistry: registryState.registry,
        gatewayMethods: params.baseMethods ?? [],
      };
    },
  };
});

const _BASE_IMAGE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X3mIAAAAASUVORK5CYII=";

const createRegistry = (channels: PluginRegistry["channels"]): PluginRegistry => ({
  plugins: [],
  tools: [],
  channels,
  providers: [],
  gatewayHandlers: {},
  httpHandlers: [],
  httpRoutes: [],
  cliRegistrars: [],
  services: [],
  diagnostics: [],
});

const createMSTeamsPlugin = (params?: { aliases?: string[] }): ChannelPlugin => ({
  id: "msteams",
  meta: {
    id: "msteams",
    label: "Microsoft Teams",
    selectionLabel: "Microsoft Teams (Bot Framework)",
    docsPath: "/channels/msteams",
    blurb: "Bot Framework; enterprise support.",
    aliases: params?.aliases,
  },
  capabilities: { chatTypes: ["direct"] },
  config: {
    listAccountIds: () => [],
    resolveAccount: () => ({}),
  },
});

const createWhatsAppPlugin = (): ChannelPlugin => ({
  id: "whatsapp",
  meta: {
    id: "whatsapp",
    label: "WhatsApp",
    selectionLabel: "WhatsApp",
    docsPath: "/channels/whatsapp",
    blurb: "WhatsApp test stub.",
  },
  capabilities: { chatTypes: ["direct"] },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({}),
    resolveAllowFrom: ({ cfg }) => {
      const channels = cfg.channels as Record<string, unknown> | undefined;
      const entry = channels?.whatsapp as Record<string, unknown> | undefined;
      const allow = entry?.allowFrom;
      return Array.isArray(allow) ? allow.map((value) => String(value)) : [];
    },
  },
  outbound: {
    deliveryMode: "direct",
    resolveTarget: ({ to, allowFrom }) => {
      const trimmed = to?.trim() ?? "";
      if (trimmed) {
        return { ok: true, to: trimmed };
      }
      const first = allowFrom?.[0];
      if (first) {
        return { ok: true, to: String(first) };
      }
      return {
        ok: false,
        error: new Error("missing target for whatsapp"),
      };
    },
    sendText: async () => ({ channel: "whatsapp", messageId: "msg-test" }),
    sendMedia: async () => ({ channel: "whatsapp", messageId: "msg-test" }),
  },
});

const emptyRegistry = createRegistry([]);
const defaultRegistry = createRegistry([
  {
    pluginId: "whatsapp",
    source: "test",
    plugin: createWhatsAppPlugin(),
  },
]);

function expectChannels(call: Record<string, unknown>, channel: string) {
  expect(call.channel).toBe(channel);
  expect(call.messageChannel).toBe(channel);
}

function findAgentCallByRunId(runId: string): Record<string, unknown> {
  const spy = vi.mocked(agentCommand);
  for (let idx = spy.mock.calls.length - 1; idx >= 0; idx -= 1) {
    const call = spy.mock.calls[idx]?.[0] as Record<string, unknown> | undefined;
    if (call?.runId === runId) {
      return call;
    }
  }
  throw new Error(`agentCommand call missing for runId=${runId}`);
}

describe("gateway server agent", () => {
  beforeEach(() => {
    testState.sessionConfig = { scope: "per-sender", mainKey: "main" };
    registryState.registry = defaultRegistry;
    setActivePluginRegistry(defaultRegistry);
  });

  afterEach(() => {
    registryState.registry = emptyRegistry;
    setActivePluginRegistry(emptyRegistry);
  });

  test("agent routes main last-channel msteams", async () => {
    const registry = createRegistry([
      {
        pluginId: "msteams",
        source: "test",
        plugin: createMSTeamsPlugin(),
      },
    ]);
    registryState.registry = registry;
    setActivePluginRegistry(registry);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-"));
    testState.sessionStorePath = path.join(dir, "sessions.json");
    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-teams",
          updatedAt: Date.now(),
          lastChannel: "msteams",
          lastTo: "conversation:teams-123",
        },
      },
    });
    const idem = "idem-agent-last-msteams";
    const res = await rpcReq(ws, "agent", {
      message: "hi",
      sessionKey: "main",
      channel: "last",
      deliver: true,
      idempotencyKey: idem,
    });
    expect(res.ok).toBe(true);

    const call = findAgentCallByRunId(idem);
    expectChannels(call, "msteams");
    expect(call.to).toBe("conversation:teams-123");
    expect(call.deliver).toBe(true);
    expect(call.bestEffortDeliver).toBe(true);
    expect(call.sessionId).toBe("sess-teams");
  });

  test("agent accepts channel aliases (imsg/teams)", async () => {
    const registry = createRegistry([
      {
        pluginId: "msteams",
        source: "test",
        plugin: createMSTeamsPlugin({ aliases: ["teams"] }),
      },
    ]);
    registryState.registry = registry;
    setActivePluginRegistry(registry);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-"));
    testState.sessionStorePath = path.join(dir, "sessions.json");
    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-alias",
          updatedAt: Date.now(),
          lastChannel: "imessage",
          lastTo: "chat_id:123",
        },
      },
    });
    const idemIMessage = "idem-agent-imsg";
    const resIMessage = await rpcReq(ws, "agent", {
      message: "hi",
      sessionKey: "main",
      channel: "imsg",
      deliver: true,
      idempotencyKey: idemIMessage,
    });
    expect(resIMessage.ok).toBe(true);

    const idemTeams = "idem-agent-teams";
    const resTeams = await rpcReq(ws, "agent", {
      message: "hi",
      sessionKey: "main",
      channel: "teams",
      to: "conversation:teams-abc",
      deliver: false,
      idempotencyKey: idemTeams,
    });
    expect(resTeams.ok).toBe(true);

    const imessageCall = findAgentCallByRunId(idemIMessage);
    expectChannels(imessageCall, "imessage");
    expect(imessageCall.to).toBe("chat_id:123");

    const teamsCall = findAgentCallByRunId(idemTeams);
    expectChannels(teamsCall, "msteams");
    expect(teamsCall.to).toBe("conversation:teams-abc");
  });

  test("agent rejects unknown channel", async () => {
    const res = await rpcReq(ws, "agent", {
      message: "hi",
      sessionKey: "main",
      channel: "sms",
      idempotencyKey: "idem-agent-bad-channel",
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_REQUEST");
  });

  test("agent ignores webchat last-channel for routing", async () => {
    testState.allowFrom = ["+1555"];
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-"));
    testState.sessionStorePath = path.join(dir, "sessions.json");
    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-main-webchat",
          updatedAt: Date.now(),
          lastChannel: "webchat",
          lastTo: "+1555",
        },
      },
    });
    const idem = "idem-agent-webchat";
    const res = await rpcReq(ws, "agent", {
      message: "hi",
      sessionKey: "main",
      channel: "last",
      deliver: true,
      idempotencyKey: idem,
    });
    expect(res.ok).toBe(true);

    const call = findAgentCallByRunId(idem);
    expectChannels(call, "whatsapp");
    expect(call.to).toBe("+1555");
    expect(call.deliver).toBe(true);
    expect(call.bestEffortDeliver).toBe(true);
    expect(call.sessionId).toBe("sess-main-webchat");
  });

  test("agent uses webchat for internal runs when last provider is webchat", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-"));
    testState.sessionStorePath = path.join(dir, "sessions.json");
    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-main-webchat-internal",
          updatedAt: Date.now(),
          lastChannel: "webchat",
          lastTo: "+1555",
        },
      },
    });
    const idem = "idem-agent-webchat-internal";
    const res = await rpcReq(ws, "agent", {
      message: "hi",
      sessionKey: "main",
      channel: "last",
      deliver: false,
      idempotencyKey: idem,
    });
    expect(res.ok).toBe(true);

    const call = findAgentCallByRunId(idem);
    expectChannels(call, "webchat");
    expect(call.to).toBeUndefined();
    expect(call.deliver).toBe(false);
    expect(call.bestEffortDeliver).toBe(true);
    expect(call.sessionId).toBe("sess-main-webchat-internal");
  });

  test("agent ack response then final response", { timeout: 8000 }, async () => {
    const ackP = onceMessage(
      ws,
      (o) => o.type === "res" && o.id === "ag1" && o.payload?.status === "accepted",
    );
    const finalP = onceMessage(
      ws,
      (o) => o.type === "res" && o.id === "ag1" && o.payload?.status !== "accepted",
    );
    ws.send(
      JSON.stringify({
        type: "req",
        id: "ag1",
        method: "agent",
        params: { message: "hi", idempotencyKey: "idem-ag" },
      }),
    );

    const ack = await ackP;
    const final = await finalP;
    expect(ack.payload.runId).toBeDefined();
    expect(final.payload.runId).toBe(ack.payload.runId);
    expect(final.payload.status).toBe("ok");
  });

  test("agent dedupes by idempotencyKey after completion", async () => {
    const firstFinalP = onceMessage(
      ws,
      (o) => o.type === "res" && o.id === "ag1" && o.payload?.status !== "accepted",
    );
    ws.send(
      JSON.stringify({
        type: "req",
        id: "ag1",
        method: "agent",
        params: { message: "hi", idempotencyKey: "same-agent" },
      }),
    );
    const firstFinal = await firstFinalP;

    const secondP = onceMessage(ws, (o) => o.type === "res" && o.id === "ag2");
    ws.send(
      JSON.stringify({
        type: "req",
        id: "ag2",
        method: "agent",
        params: { message: "hi again", idempotencyKey: "same-agent" },
      }),
    );
    const second = await secondP;
    expect(second.payload).toEqual(firstFinal.payload);
  });

  test("agent dedupe survives reconnect", { timeout: 60_000 }, async () => {
    const port = await getFreePort();
    const server = await startGatewayServer(port);

    const dial = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => ws.once("open", resolve));
      await connectOk(ws);
      return ws;
    };

    const idem = "reconnect-agent";
    const ws1 = await dial();
    const final1P = onceMessage(
      ws1,
      (o) => o.type === "res" && o.id === "ag1" && o.payload?.status !== "accepted",
      6000,
    );
    ws1.send(
      JSON.stringify({
        type: "req",
        id: "ag1",
        method: "agent",
        params: { message: "hi", idempotencyKey: idem },
      }),
    );
    const final1 = await final1P;
    ws1.close();

    const ws2 = await dial();
    const final2P = onceMessage(
      ws2,
      (o) => o.type === "res" && o.id === "ag2" && o.payload?.status !== "accepted",
      6000,
    );
    ws2.send(
      JSON.stringify({
        type: "req",
        id: "ag2",
        method: "agent",
        params: { message: "hi again", idempotencyKey: idem },
      }),
    );
    const res = await final2P;
    expect(res.payload).toEqual(final1.payload);
    ws2.close();
    await server.close();
  });

  test("agent events stream to webchat clients when run context is registered", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-"));
    testState.sessionStorePath = path.join(dir, "sessions.json");
    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-main",
          updatedAt: Date.now(),
          ownerUserId: "user-webchat",
        },
      },
    });

    const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => webchatWs.once("open", resolve));
    await connectOk(webchatWs, {
      client: {
        id: GATEWAY_CLIENT_NAMES.WEBCHAT,
        version: "1.0.0",
        platform: "test",
        mode: GATEWAY_CLIENT_MODES.WEBCHAT,
      },
      identity: {
        userId: "user-webchat",
        principalId: "user-webchat:principal",
        alias: "Webchat User",
      },
    });

    registerAgentRunContext("run-auto-1", { sessionKey: "main" });

    const finalChatP = onceMessage(
      webchatWs,
      (o) => {
        if (o.type !== "event" || o.event !== "chat") {
          return false;
        }
        const payload = o.payload as { state?: unknown; runId?: unknown } | undefined;
        return payload?.state === "final" && payload.runId === "run-auto-1";
      },
      8000,
    );

    emitAgentEvent({
      runId: "run-auto-1",
      stream: "assistant",
      data: { text: "hi from agent" },
    });
    emitAgentEvent({
      runId: "run-auto-1",
      stream: "lifecycle",
      data: { phase: "end" },
    });

    const evt = await finalChatP;
    const payload =
      evt.payload && typeof evt.payload === "object"
        ? (evt.payload as Record<string, unknown>)
        : {};
    expect(payload.sessionKey).toBe("main");
    expect(payload.runId).toBe("run-auto-1");

    webchatWs.close();
  });
});
