import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import { emitAgentEvent, registerAgentRunContext } from "../infra/agent-events.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import {
  agentCommand,
  connectOk,
  getReplyFromConfig,
  installGatewayTestHooks,
  onceMessage,
  rpcReq,
  startServerWithClient,
  testState,
  writeSessionStore,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startServerWithClient>>["server"];
let ws: WebSocket;
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

async function waitFor(condition: () => boolean, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("timeout waiting for condition");
}

function rawDataToString(raw: WebSocket.RawData): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8");
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }
  return Buffer.from(raw).toString("utf8");
}

describe("gateway server chat", () => {
  test("handles chat send and history flows", async () => {
    const tempDirs: string[] = [];
    let webchatWs: WebSocket | undefined;

    try {
      webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs?.once("open", resolve));
      await connectOk(webchatWs, {
        client: {
          id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
          version: "dev",
          platform: "web",
          mode: GATEWAY_CLIENT_MODES.WEBCHAT,
        },
      });

      const webchatRes = await rpcReq(webchatWs, "chat.send", {
        sessionKey: "main",
        message: "hello",
        idempotencyKey: "idem-webchat-1",
      });
      expect(webchatRes.ok).toBe(true);

      webchatWs.close();
      webchatWs = undefined;

      const spy = vi.mocked(getReplyFromConfig);
      spy.mockClear();
      testState.agentConfig = { timeoutSeconds: 123 };
      const callsBeforeTimeout = spy.mock.calls.length;
      const timeoutRes = await rpcReq(ws, "chat.send", {
        sessionKey: "main",
        message: "hello",
        idempotencyKey: "idem-timeout-1",
      });
      expect(timeoutRes.ok).toBe(true);

      await waitFor(() => spy.mock.calls.length > callsBeforeTimeout);
      const timeoutCall = spy.mock.calls.at(-1)?.[1] as { runId?: string } | undefined;
      expect(timeoutCall?.runId).toBe("idem-timeout-1");
      testState.agentConfig = undefined;

      spy.mockClear();
      const callsBeforeSession = spy.mock.calls.length;
      const sessionRes = await rpcReq(ws, "chat.send", {
        sessionKey: "agent:main:subagent:abc",
        message: "hello",
        idempotencyKey: "idem-session-key-1",
      });
      expect(sessionRes.ok).toBe(true);

      await waitFor(() => spy.mock.calls.length > callsBeforeSession);
      const sessionCall = spy.mock.calls.at(-1)?.[0] as { SessionKey?: string } | undefined;
      expect(sessionCall?.SessionKey).toBe("agent:main:subagent:abc");

      const sendPolicyDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-"));
      tempDirs.push(sendPolicyDir);
      testState.sessionStorePath = path.join(sendPolicyDir, "sessions.json");
      testState.sessionConfig = {
        sendPolicy: {
          default: "allow",
          rules: [
            {
              action: "deny",
              match: { channel: "discord", chatType: "group" },
            },
          ],
        },
      };

      await writeSessionStore({
        entries: {
          "discord:group:dev": {
            sessionId: "sess-discord",
            updatedAt: Date.now(),
            chatType: "group",
            channel: "discord",
          },
        },
      });

      const blockedRes = await rpcReq(ws, "chat.send", {
        sessionKey: "discord:group:dev",
        message: "hello",
        idempotencyKey: "idem-1",
      });
      expect(blockedRes.ok).toBe(false);
      expect((blockedRes.error as { message?: string } | undefined)?.message ?? "").toMatch(
        /send blocked/i,
      );

      testState.sessionStorePath = undefined;
      testState.sessionConfig = undefined;

      const agentBlockedDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-"));
      tempDirs.push(agentBlockedDir);
      testState.sessionStorePath = path.join(agentBlockedDir, "sessions.json");
      testState.sessionConfig = {
        sendPolicy: {
          default: "allow",
          rules: [{ action: "deny", match: { keyPrefix: "cron:" } }],
        },
      };

      await writeSessionStore({
        entries: {
          "cron:job-1": {
            sessionId: "sess-cron",
            updatedAt: Date.now(),
          },
        },
      });

      const agentBlockedRes = await rpcReq(ws, "agent", {
        sessionKey: "cron:job-1",
        message: "hi",
        idempotencyKey: "idem-2",
      });
      expect(agentBlockedRes.ok).toBe(false);
      expect((agentBlockedRes.error as { message?: string } | undefined)?.message ?? "").toMatch(
        /send blocked/i,
      );

      testState.sessionStorePath = undefined;
      testState.sessionConfig = undefined;

      spy.mockClear();
      const callsBeforeImage = spy.mock.calls.length;
      const pngB64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

      const reqId = "chat-img";
      ws.send(
        JSON.stringify({
          type: "req",
          id: reqId,
          method: "chat.send",
          params: {
            sessionKey: "main",
            message: "see image",
            idempotencyKey: "idem-img",
            attachments: [
              {
                type: "image",
                mimeType: "image/png",
                fileName: "dot.png",
                content: `data:image/png;base64,${pngB64}`,
              },
            ],
          },
        }),
      );

      const imgRes = await onceMessage(ws, (o) => o.type === "res" && o.id === reqId, 8000);
      expect(imgRes.ok).toBe(true);
      expect(imgRes.payload?.runId).toBeDefined();

      await waitFor(() => spy.mock.calls.length > callsBeforeImage, 8000);
      const imgOpts = spy.mock.calls.at(-1)?.[1] as
        | { images?: Array<{ type: string; data: string; mimeType: string }> }
        | undefined;
      expect(imgOpts?.images).toEqual([{ type: "image", data: pngB64, mimeType: "image/png" }]);

      const callsBeforeImageOnly = spy.mock.calls.length;
      const reqIdOnly = "chat-img-only";
      ws.send(
        JSON.stringify({
          type: "req",
          id: reqIdOnly,
          method: "chat.send",
          params: {
            sessionKey: "main",
            message: "",
            idempotencyKey: "idem-img-only",
            attachments: [
              {
                type: "image",
                mimeType: "image/png",
                fileName: "dot.png",
                content: `data:image/png;base64,${pngB64}`,
              },
            ],
          },
        }),
      );

      const imgOnlyRes = await onceMessage(ws, (o) => o.type === "res" && o.id === reqIdOnly, 8000);
      expect(imgOnlyRes.ok).toBe(true);
      expect(imgOnlyRes.payload?.runId).toBeDefined();

      await waitFor(() => spy.mock.calls.length > callsBeforeImageOnly, 8000);
      const imgOnlyOpts = spy.mock.calls.at(-1)?.[1] as
        | { images?: Array<{ type: string; data: string; mimeType: string }> }
        | undefined;
      expect(imgOnlyOpts?.images).toEqual([{ type: "image", data: pngB64, mimeType: "image/png" }]);

      const historyDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-"));
      tempDirs.push(historyDir);
      testState.sessionStorePath = path.join(historyDir, "sessions.json");
      await writeSessionStore({
        entries: {
          main: {
            sessionId: "sess-main",
            updatedAt: Date.now(),
            ownerUserId: "user-a",
          },
        },
      });

      const lines: string[] = [];
      for (let i = 0; i < 300; i += 1) {
        lines.push(
          JSON.stringify({
            message: {
              role: "user",
              content: [{ type: "text", text: `m${i}` }],
              timestamp: Date.now() + i,
            },
          }),
        );
      }
      await fs.writeFile(path.join(historyDir, "sess-main.jsonl"), lines.join("\n"), "utf-8");

      const defaultRes = await rpcReq<{ messages?: unknown[] }>(ws, "chat.history", {
        sessionKey: "main",
      });
      expect(defaultRes.ok).toBe(true);
      const defaultMsgs = defaultRes.payload?.messages ?? [];
      const firstContentText = (msg: unknown): string | undefined => {
        if (!msg || typeof msg !== "object") {
          return undefined;
        }
        const content = (msg as { content?: unknown }).content;
        if (!Array.isArray(content) || content.length === 0) {
          return undefined;
        }
        const first = content[0];
        if (!first || typeof first !== "object") {
          return undefined;
        }
        const text = (first as { text?: unknown }).text;
        return typeof text === "string" ? text : undefined;
      };
      expect(defaultMsgs.length).toBe(200);
      expect(firstContentText(defaultMsgs[0])).toBe("m100");
    } finally {
      testState.agentConfig = undefined;
      testState.sessionStorePath = undefined;
      testState.sessionConfig = undefined;
      if (webchatWs) {
        webchatWs.close();
      }
      await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    }
  });

  test("routes chat.send slash commands without agent runs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-"));
    try {
      testState.sessionStorePath = path.join(dir, "sessions.json");
      await writeSessionStore({
        entries: {
          main: {
            sessionId: "sess-main",
            updatedAt: Date.now(),
          },
        },
      });

      const spy = vi.mocked(agentCommand);
      const callsBefore = spy.mock.calls.length;
      const res = await rpcReq(ws, "chat.send", {
        sessionKey: "main",
        message: "/context list",
        idempotencyKey: "idem-command-1",
      });
      expect(res.ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(spy.mock.calls.length).toBe(callsBefore);
    } finally {
      testState.sessionStorePath = undefined;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("chat methods deny owner mismatch for non-admin users", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-chat-owner-"));
    const userWs = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => userWs.once("open", resolve));
    const sinceTs = Date.now();

    try {
      await connectOk(userWs, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-b",
          principalId: "msg:discord:default:user-b",
          alias: "Bob",
        },
      });

      testState.sessionStorePath = path.join(dir, "sessions.json");
      await writeSessionStore({
        entries: {
          main: {
            sessionId: "sess-owner-a",
            updatedAt: Date.now(),
            ownerUserId: "user-a",
          },
        },
      });

      const historyDenied = await rpcReq(userWs, "chat.history", {
        sessionKey: "main",
      });
      expect(historyDenied.ok).toBe(false);
      expect(historyDenied.error?.message ?? "").toContain("owner mismatch");
      expect(
        (
          historyDenied.error as
            | {
                details?: { reasonCode?: string };
              }
            | undefined
        )?.details?.reasonCode,
      ).toBe("OWNER_MISMATCH");

      const sendDenied = await rpcReq(userWs, "chat.send", {
        sessionKey: "main",
        message: "try cross-owner read",
        idempotencyKey: "idem-cross-owner-send",
      });
      expect(sendDenied.ok).toBe(false);
      expect(sendDenied.error?.message ?? "").toContain("owner mismatch");
      expect(
        (
          sendDenied.error as
            | {
                details?: { reasonCode?: string };
              }
            | undefined
        )?.details?.reasonCode,
      ).toBe("OWNER_MISMATCH");

      const abortDenied = await rpcReq(userWs, "chat.abort", {
        sessionKey: "main",
      });
      expect(abortDenied.ok).toBe(false);
      expect(abortDenied.error?.message ?? "").toContain("owner mismatch");
      expect(
        (
          abortDenied.error as
            | {
                details?: { reasonCode?: string };
              }
            | undefined
        )?.details?.reasonCode,
      ).toBe("OWNER_MISMATCH");

      const deniedFeed = await rpcReq<{
        events?: Array<{ method?: string; userAlias?: string | null }>;
      }>(ws, "authz.denied.list", {
        reasonCode: "OWNER_MISMATCH",
        userId: "user-b",
        sinceTs,
        limit: 50,
      });
      expect(deniedFeed.ok).toBe(true);
      const deniedMethods = (deniedFeed.payload?.events ?? []).map((event) => event.method);
      expect(deniedMethods).toContain("chat.history");
      expect(deniedMethods).toContain("chat.send");
      expect(deniedMethods).toContain("chat.abort");
      expect((deniedFeed.payload?.events ?? []).some((event) => event.userAlias === "Bob")).toBe(
        true,
      );
    } finally {
      userWs.close();
      testState.sessionStorePath = undefined;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("chat methods allow delegated session access for non-admin users", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-chat-owner-delegated-"));
    const userWs = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => userWs.once("open", resolve));

    try {
      await connectOk(userWs, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-b",
          principalId: "msg:discord:default:user-b",
          alias: "Bob",
        },
      });

      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode: "strict",
            delegation: {
              enabled: true,
              rules: [
                {
                  fromUserId: "user-b",
                  toUserId: "user-a",
                  resources: ["sessions"],
                },
              ],
            },
          },
        },
      });

      testState.sessionStorePath = path.join(dir, "sessions.json");
      await writeSessionStore({
        entries: {
          main: {
            sessionId: "sess-owner-a",
            updatedAt: Date.now(),
            ownerUserId: "user-a",
          },
        },
      });

      const historyAllowed = await rpcReq<{
        sessionKey?: string;
        sessionId?: string;
      }>(userWs, "chat.history", {
        sessionKey: "main",
      });
      expect(historyAllowed.ok).toBe(true);
      expect(historyAllowed.payload?.sessionKey).toBe("main");
      expect(historyAllowed.payload?.sessionId).toBe("sess-owner-a");

      const sendAllowed = await rpcReq(userWs, "chat.send", {
        sessionKey: "main",
        message: "/context list",
        idempotencyKey: "idem-chat-delegated-send",
      });
      expect(sendAllowed.ok).toBe(true);

      const abortAllowed = await rpcReq(userWs, "chat.abort", {
        sessionKey: "main",
      });
      expect(abortAllowed.ok).toBe(true);
    } finally {
      userWs.close();
      testState.sessionStorePath = undefined;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("agent.wait accepts owner-bound run ids from chat.send", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-chat-wait-owner-"));
    const userWs = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => userWs.once("open", resolve));

    try {
      await connectOk(userWs, {
        scopes: ["operator.write"],
        identity: {
          userId: "user-a",
          principalId: "msg:discord:default:user-a",
          alias: "Alice",
        },
      });

      testState.sessionStorePath = path.join(dir, "sessions.json");
      await writeSessionStore({
        entries: {
          main: {
            sessionId: "sess-owner-a",
            updatedAt: Date.now(),
            ownerUserId: "user-a",
          },
        },
      });

      const runId = "idem-chat-owner-wait";
      const sendRes = await rpcReq(userWs, "chat.send", {
        sessionKey: "main",
        message: "/context list",
        idempotencyKey: runId,
      });
      expect(sendRes.ok).toBe(true);

      const waitRes = await rpcReq<{
        runId?: string;
        status?: "ok" | "timeout" | "error";
      }>(userWs, "agent.wait", {
        runId,
        timeoutMs: 50,
      });
      expect(waitRes.ok).toBe(true);
      expect(waitRes.payload?.runId).toBe(runId);
      expect(waitRes.payload?.status === "ok" || waitRes.payload?.status === "timeout").toBe(true);
    } finally {
      userWs.close();
      testState.sessionStorePath = undefined;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("runtime chat and agent events are isolated to session owner even with scope-only admin request", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-owner-fanout-"));
    const ownerInstanceId = "owner-a";
    const otherInstanceId = "other-b";
    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: {
          mode: "strict",
          identities: {
            [`client:${GATEWAY_CLIENT_NAMES.WEBCHAT}:${ownerInstanceId}`]: {
              userId: "user-a",
              principalId: "msg:discord:default:user-a",
              alias: "Alice",
              role: "user",
            },
            [`client:${GATEWAY_CLIENT_NAMES.WEBCHAT}:${otherInstanceId}`]: {
              userId: "user-b",
              principalId: "msg:discord:default:user-b",
              alias: "Bob",
              role: "user",
            },
          },
        },
      },
    });
    const userAws = new WebSocket(`ws://127.0.0.1:${port}`);
    const userBws = new WebSocket(`ws://127.0.0.1:${port}`);
    await Promise.all([
      new Promise<void>((resolve) => userAws.once("open", resolve)),
      new Promise<void>((resolve) => userBws.once("open", resolve)),
    ]);

    try {
      const [ownerHello, otherHello] = await Promise.all([
        connectOk(userAws, {
          scopes: ["operator.write"],
          identity: {
            userId: "user-a",
            principalId: "msg:discord:default:user-a",
            alias: "Alice",
          },
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT,
            version: "1.0.0",
            platform: "test",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
            instanceId: ownerInstanceId,
          },
        }),
        connectOk(userBws, {
          scopes: ["operator.write", "operator.admin"],
          identity: {
            userId: "user-b",
            principalId: "msg:discord:default:user-b",
            alias: "Bob",
          },
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT,
            version: "1.0.0",
            platform: "test",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
            instanceId: otherInstanceId,
          },
        }),
      ]);
      expect(ownerHello.auth?.principalRole).toBe("user");
      expect(otherHello.auth?.principalRole).toBe("user");

      testState.sessionStorePath = path.join(dir, "sessions.json");
      await writeSessionStore({
        entries: {
          main: {
            sessionId: "sess-owner-a",
            updatedAt: Date.now(),
            ownerUserId: "user-a",
          },
        },
      });

      registerAgentRunContext("run-owner-fanout", {
        sessionKey: "main",
      });

      const ownerAgentEventP = onceMessage(
        userAws,
        (o) =>
          o.type === "event" &&
          o.event === "agent" &&
          o.payload?.runId === "run-owner-fanout" &&
          o.payload?.sessionKey === "main",
        6000,
      );
      const adminAgentEventP = onceMessage(
        ws,
        (o) =>
          o.type === "event" &&
          o.event === "agent" &&
          o.payload?.runId === "run-owner-fanout" &&
          o.payload?.sessionKey === "main",
        6000,
      );

      let otherUserReceived = false;
      const otherUserListener = (raw: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(rawDataToString(raw)) as {
            type?: string;
            event?: string;
            payload?: { runId?: string };
          };
          if (
            parsed.type === "event" &&
            (parsed.event === "agent" || parsed.event === "chat") &&
            parsed.payload?.runId === "run-owner-fanout"
          ) {
            otherUserReceived = true;
          }
        } catch {
          /* ignore malformed test frames */
        }
      };
      userBws.on("message", otherUserListener);

      emitAgentEvent({
        runId: "run-owner-fanout",
        stream: "assistant",
        data: { text: "owner scoped event" },
      });

      const ownerEvent = await ownerAgentEventP;
      expect(ownerEvent.type).toBe("event");
      expect(ownerEvent.event).toBe("agent");
      expect(ownerEvent.payload?.sessionKey).toBe("main");
      const adminEvent = await adminAgentEventP;
      expect(adminEvent.type).toBe("event");
      expect(adminEvent.event).toBe("agent");
      expect(adminEvent.payload?.sessionKey).toBe("main");

      await new Promise((resolve) => setTimeout(resolve, 250));
      userBws.off("message", otherUserListener);
      expect(otherUserReceived).toBe(false);
    } finally {
      userAws.close();
      userBws.close();
      testState.sessionStorePath = undefined;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("runtime owner-scoped events follow strict/off mode changes without reconnect", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-owner-fanout-mode-switch-"));
    const ownerInstanceId = "owner-a-mode-switch";
    const otherInstanceId = "other-b-mode-switch";
    const { writeConfigFile } = await import("../config/config.js");
    const identities = {
      [`client:${GATEWAY_CLIENT_NAMES.WEBCHAT}:${ownerInstanceId}`]: {
        userId: "user-a",
        principalId: "msg:discord:default:user-a",
        alias: "Alice",
        role: "user",
      },
      [`client:${GATEWAY_CLIENT_NAMES.WEBCHAT}:${otherInstanceId}`]: {
        userId: "user-b",
        principalId: "msg:discord:default:user-b",
        alias: "Bob",
        role: "user",
      },
    } as const;
    const writeMode = async (mode: "strict" | "off") => {
      await writeConfigFile({
        gateway: {
          multiUser: {
            mode,
            identities,
          },
        },
      });
    };
    await writeMode("strict");

    const userAws = new WebSocket(`ws://127.0.0.1:${port}`);
    const userBws = new WebSocket(`ws://127.0.0.1:${port}`);
    await Promise.all([
      new Promise<void>((resolve) => userAws.once("open", resolve)),
      new Promise<void>((resolve) => userBws.once("open", resolve)),
    ]);

    const marker = `owner-fanout-mode-switch-${Date.now()}`;
    const observedOtherRunIds = new Set<string>();
    const waitForObservedOtherRunId = async (runId: string): Promise<void> => {
      await waitFor(() => observedOtherRunIds.has(runId), 6000);
    };
    const waitForNoObservedOtherRunId = async (runId: string, waitMs = 300): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      expect(observedOtherRunIds.has(runId)).toBe(false);
    };
    const otherUserListener = (raw: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(rawDataToString(raw)) as {
          type?: string;
          event?: string;
          payload?: { runId?: string; sessionKey?: string };
        };
        if (
          parsed.type === "event" &&
          parsed.event === "agent" &&
          parsed.payload?.sessionKey === "main" &&
          typeof parsed.payload?.runId === "string"
        ) {
          observedOtherRunIds.add(parsed.payload.runId);
        }
      } catch {
        /* ignore malformed test frames */
      }
    };
    userBws.on("message", otherUserListener);

    const emitOwnerScopedRun = async (runId: string): Promise<void> => {
      registerAgentRunContext(runId, {
        sessionKey: "main",
      });
      const ownerEventP = onceMessage(
        userAws,
        (o) =>
          o.type === "event" &&
          o.event === "agent" &&
          o.payload?.runId === runId &&
          o.payload?.sessionKey === "main",
        6000,
      );
      emitAgentEvent({
        runId,
        stream: "assistant",
        data: { text: `mode switch event ${runId}` },
      });
      const ownerEvent = await ownerEventP;
      expect(ownerEvent.type).toBe("event");
      expect(ownerEvent.event).toBe("agent");
      expect(ownerEvent.payload?.sessionKey).toBe("main");
    };

    try {
      const [ownerHello, otherHello] = await Promise.all([
        connectOk(userAws, {
          scopes: ["operator.write"],
          identity: {
            userId: "user-a",
            principalId: "msg:discord:default:user-a",
            alias: "Alice",
          },
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT,
            version: "1.0.0",
            platform: "test",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
            instanceId: ownerInstanceId,
          },
        }),
        connectOk(userBws, {
          scopes: ["operator.write", "operator.admin"],
          identity: {
            userId: "user-b",
            principalId: "msg:discord:default:user-b",
            alias: "Bob",
          },
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT,
            version: "1.0.0",
            platform: "test",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
            instanceId: otherInstanceId,
          },
        }),
      ]);
      expect(ownerHello.auth?.principalRole).toBe("user");
      expect(otherHello.auth?.principalRole).toBe("user");

      testState.sessionStorePath = path.join(dir, "sessions.json");
      await writeSessionStore({
        entries: {
          main: {
            sessionId: "sess-owner-a",
            updatedAt: Date.now(),
            ownerUserId: "user-a",
          },
        },
      });

      const strictInitialRunId = `${marker}-strict-initial`;
      await emitOwnerScopedRun(strictInitialRunId);
      await waitForNoObservedOtherRunId(strictInitialRunId);

      await writeMode("off");
      const offRunId = `${marker}-off`;
      await emitOwnerScopedRun(offRunId);
      await waitForObservedOtherRunId(offRunId);

      await writeMode("strict");
      const strictFinalRunId = `${marker}-strict-final`;
      await emitOwnerScopedRun(strictFinalRunId);
      await waitForNoObservedOtherRunId(strictFinalRunId);
    } finally {
      userBws.off("message", otherUserListener);
      userAws.close();
      userBws.close();
      testState.sessionStorePath = undefined;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("runtime owner-scoped events include delegated users with sessions delegation", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-owner-fanout-delegated-"));
    const ownerInstanceId = "owner-a-delegated";
    const delegatedInstanceId = "delegated-b";
    const { writeConfigFile } = await import("../config/config.js");
    await writeConfigFile({
      gateway: {
        multiUser: {
          mode: "strict",
          identities: {
            [`client:${GATEWAY_CLIENT_NAMES.WEBCHAT}:${ownerInstanceId}`]: {
              userId: "user-a",
              principalId: "msg:discord:default:user-a",
              alias: "Alice",
              role: "user",
            },
            [`client:${GATEWAY_CLIENT_NAMES.WEBCHAT}:${delegatedInstanceId}`]: {
              userId: "user-b",
              principalId: "msg:discord:default:user-b",
              alias: "Bob",
              role: "user",
            },
          },
          delegation: {
            enabled: true,
            rules: [
              {
                fromUserId: "user-b",
                toUserId: "user-a",
                resources: ["sessions"],
              },
            ],
          },
        },
      },
    });
    const userAws = new WebSocket(`ws://127.0.0.1:${port}`);
    const userBws = new WebSocket(`ws://127.0.0.1:${port}`);
    await Promise.all([
      new Promise<void>((resolve) => userAws.once("open", resolve)),
      new Promise<void>((resolve) => userBws.once("open", resolve)),
    ]);

    try {
      await Promise.all([
        connectOk(userAws, {
          scopes: ["operator.write"],
          identity: {
            userId: "user-a",
            principalId: "msg:discord:default:user-a",
            alias: "Alice",
          },
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT,
            version: "1.0.0",
            platform: "test",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
            instanceId: ownerInstanceId,
          },
        }),
        connectOk(userBws, {
          scopes: ["operator.write"],
          identity: {
            userId: "user-b",
            principalId: "msg:discord:default:user-b",
            alias: "Bob",
          },
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT,
            version: "1.0.0",
            platform: "test",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
            instanceId: delegatedInstanceId,
          },
        }),
      ]);

      testState.sessionStorePath = path.join(dir, "sessions.json");
      await writeSessionStore({
        entries: {
          main: {
            sessionId: "sess-owner-a",
            updatedAt: Date.now(),
            ownerUserId: "user-a",
          },
        },
      });

      registerAgentRunContext("run-owner-fanout-delegated", {
        sessionKey: "main",
      });

      const ownerAgentEventP = onceMessage(
        userAws,
        (o) =>
          o.type === "event" &&
          o.event === "agent" &&
          o.payload?.runId === "run-owner-fanout-delegated" &&
          o.payload?.sessionKey === "main",
        6000,
      );
      const delegatedAgentEventP = onceMessage(
        userBws,
        (o) =>
          o.type === "event" &&
          o.event === "agent" &&
          o.payload?.runId === "run-owner-fanout-delegated" &&
          o.payload?.sessionKey === "main",
        6000,
      );

      emitAgentEvent({
        runId: "run-owner-fanout-delegated",
        stream: "assistant",
        data: { text: "delegated event" },
      });

      const ownerEvent = await ownerAgentEventP;
      expect(ownerEvent.type).toBe("event");
      expect(ownerEvent.event).toBe("agent");
      expect(ownerEvent.payload?.sessionKey).toBe("main");

      const delegatedEvent = await delegatedAgentEventP;
      expect(delegatedEvent.type).toBe("event");
      expect(delegatedEvent.event).toBe("agent");
      expect(delegatedEvent.payload?.sessionKey).toBe("main");
    } finally {
      userAws.close();
      userBws.close();
      testState.sessionStorePath = undefined;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("agent events include sessionKey and agent.wait covers lifecycle flows", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-"));
    testState.sessionStorePath = path.join(dir, "sessions.json");
    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-main",
          updatedAt: Date.now(),
          ownerUserId: "user-a",
          verboseLevel: "off",
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
    });

    try {
      registerAgentRunContext("run-tool-1", {
        sessionKey: "main",
        verboseLevel: "on",
      });

      {
        const agentEvtP = onceMessage(
          webchatWs,
          (o) => o.type === "event" && o.event === "agent" && o.payload?.runId === "run-tool-1",
          8000,
        );

        emitAgentEvent({
          runId: "run-tool-1",
          stream: "assistant",
          data: { text: "hello" },
        });

        const evt = await agentEvtP;
        const payload =
          evt.payload && typeof evt.payload === "object"
            ? (evt.payload as Record<string, unknown>)
            : {};
        expect(payload.sessionKey).toBe("main");
        expect(payload.stream).toBe("assistant");
      }

      {
        const waitP = rpcReq(webchatWs, "agent.wait", {
          runId: "run-wait-1",
          timeoutMs: 1000,
        });

        setTimeout(() => {
          emitAgentEvent({
            runId: "run-wait-1",
            stream: "lifecycle",
            data: { phase: "end", startedAt: 200, endedAt: 210 },
          });
        }, 5);

        const res = await waitP;
        expect(res.ok).toBe(true);
        expect(res.payload.status).toBe("ok");
        expect(res.payload.startedAt).toBe(200);
      }

      {
        emitAgentEvent({
          runId: "run-wait-early",
          stream: "lifecycle",
          data: { phase: "end", startedAt: 50, endedAt: 55 },
        });

        const res = await rpcReq(webchatWs, "agent.wait", {
          runId: "run-wait-early",
          timeoutMs: 1000,
        });
        expect(res.ok).toBe(true);
        expect(res.payload.status).toBe("ok");
        expect(res.payload.startedAt).toBe(50);
      }

      {
        const res = await rpcReq(webchatWs, "agent.wait", {
          runId: "run-wait-3",
          timeoutMs: 30,
        });
        expect(res.ok).toBe(true);
        expect(res.payload.status).toBe("timeout");
      }

      {
        const waitP = rpcReq(webchatWs, "agent.wait", {
          runId: "run-wait-err",
          timeoutMs: 1000,
        });

        setTimeout(() => {
          emitAgentEvent({
            runId: "run-wait-err",
            stream: "lifecycle",
            data: { phase: "error", error: "boom" },
          });
        }, 5);

        const res = await waitP;
        expect(res.ok).toBe(true);
        expect(res.payload.status).toBe("error");
        expect(res.payload.error).toBe("boom");
      }

      {
        const waitP = rpcReq(webchatWs, "agent.wait", {
          runId: "run-wait-start",
          timeoutMs: 1000,
        });

        emitAgentEvent({
          runId: "run-wait-start",
          stream: "lifecycle",
          data: { phase: "start", startedAt: 123 },
        });

        setTimeout(() => {
          emitAgentEvent({
            runId: "run-wait-start",
            stream: "lifecycle",
            data: { phase: "end", endedAt: 456 },
          });
        }, 5);

        const res = await waitP;
        expect(res.ok).toBe(true);
        expect(res.payload.status).toBe("ok");
        expect(res.payload.startedAt).toBe(123);
        expect(res.payload.endedAt).toBe(456);
      }
    } finally {
      webchatWs.close();
      await fs.rm(dir, { recursive: true, force: true });
      testState.sessionStorePath = undefined;
    }
  });
});
