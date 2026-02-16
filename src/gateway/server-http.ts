import type { TlsOptions } from "node:tls";
import type { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { CanvasHostHandler } from "../canvas-host/server.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { resolveAgentAvatar } from "../agents/identity-avatar.js";
import {
  A2UI_PATH,
  CANVAS_HOST_PATH,
  CANVAS_WS_PATH,
  handleA2uiHttpRequest,
} from "../canvas-host/a2ui.js";
import { loadConfig } from "../config/config.js";
import { handleSlackHttpRequest } from "../slack/http/index.js";
import { resolveGatewayRequestSourceIp } from "./audit-source-ip.js";
import { authorizeGatewayConnect, isLocalDirectRequest, type ResolvedGatewayAuth } from "./auth.js";
import { recordGatewayAuthzAllowEvent } from "./authz-allow-events.js";
import { recordGatewayAuthzDenyEvent } from "./authz-denied-events.js";
import {
  handleControlUiAvatarRequest,
  handleControlUiHttpRequest,
  type ControlUiRootState,
} from "./control-ui.js";
import { applyHookMappings } from "./hooks-mapping.js";
import {
  extractHookToken,
  getHookAgentPolicyError,
  getHookChannelError,
  type HookMessageChannel,
  type HooksConfigResolved,
  isHookAgentAllowed,
  normalizeAgentPayload,
  normalizeHookHeaders,
  normalizeWakePayload,
  readJsonBody,
  resolveHookTargetAgentId,
  resolveHookChannel,
  resolveHookDeliver,
} from "./hooks.js";
import { sendUnauthorized } from "./http-common.js";
import { getBearerToken } from "./http-utils.js";
import { resolveGatewayMultiUserMode } from "./multi-user-mode.js";
import { handleOpenAiHttpRequest } from "./openai-http.js";
import { handleOpenResponsesHttpRequest } from "./openresponses-http.js";
import { normalizeGatewayBoundaryPath } from "./path-normalize.js";
import { handleToolsInvokeHttpRequest } from "./tools-invoke-http.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

type HookDispatchers = {
  dispatchWakeHook: (value: { text: string; mode: "now" | "next-heartbeat" }) => void;
  dispatchAgentHook: (value: {
    message: string;
    name: string;
    agentId?: string;
    wakeMode: "now" | "next-heartbeat";
    sessionKey: string;
    deliver: boolean;
    channel: HookMessageChannel;
    to?: string;
    model?: string;
    thinking?: string;
    timeoutSeconds?: number;
    allowUnsafeExternalContent?: boolean;
  }) => string;
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function isCanvasPath(pathname: string): boolean {
  const normalizedPath = normalizeGatewayBoundaryPath(pathname);
  return (
    normalizedPath === A2UI_PATH ||
    normalizedPath.startsWith(`${A2UI_PATH}/`) ||
    normalizedPath === CANVAS_HOST_PATH ||
    normalizedPath.startsWith(`${CANVAS_HOST_PATH}/`) ||
    normalizedPath === CANVAS_WS_PATH ||
    normalizedPath.startsWith(`${CANVAS_WS_PATH}/`)
  );
}

function hasAuthorizedWsClientForIp(clients: Set<GatewayWsClient>, clientIp: string): boolean {
  for (const client of clients) {
    if (client.clientIp && client.clientIp === clientIp) {
      return true;
    }
  }
  return false;
}

async function authorizeCanvasRequest(params: {
  req: IncomingMessage;
  config: ReturnType<typeof loadConfig>;
  auth: ResolvedGatewayAuth;
  trustedProxies: string[];
  clients: Set<GatewayWsClient>;
  denyMethod: "http.canvas" | "ws.canvas";
}): Promise<boolean> {
  const { req, config, auth, trustedProxies, clients } = params;
  const localDirect = isLocalDirectRequest(req, trustedProxies);
  const sourceIp = resolveGatewayRequestSourceIp({ req, trustedProxies });
  const multiUserMode = resolveGatewayMultiUserMode(config);
  if (localDirect) {
    if (multiUserMode !== "off") {
      recordGatewayAuthzAllowEvent({
        ts: Date.now(),
        requestId: randomUUID(),
        method: params.denyMethod,
        userId: null,
        principalId: null,
        actorRole: null,
        sourceRole: null,
        clientId: params.denyMethod,
        clientMode: "http",
        sourceIp,
      });
    }
    return true;
  }
  if (multiUserMode !== "off") {
    const message = "canvas endpoints are local-admin only while gateway.multiUser.mode is enabled";
    recordGatewayAuthzDenyEvent({
      ts: Date.now(),
      requestId: randomUUID(),
      method: params.denyMethod,
      reasonCode: "ROLE_FORBIDDEN",
      errorCode: "INVALID_REQUEST",
      errorMessage: message,
      userId: null,
      principalId: null,
      actorRole: null,
      sourceRole: null,
      clientId: params.denyMethod,
      clientMode: "http",
      sourceIp,
    });
    return false;
  }

  const token = getBearerToken(req);
  let tokenFailed = false;
  if (token) {
    const authResult = await authorizeGatewayConnect({
      auth: { ...auth, allowTailscale: false },
      connectAuth: { token, password: token },
      req,
      trustedProxies,
    });
    if (authResult.ok) {
      return true;
    }
    tokenFailed = true;
  }

  const clientIp = sourceIp;
  if (clientIp && hasAuthorizedWsClientForIp(clients, clientIp)) {
    return true;
  }
  const message = tokenFailed
    ? "canvas endpoint token invalid and no authorized gateway websocket client for source IP"
    : "canvas endpoint token missing and no authorized gateway websocket client for source IP";
  recordGatewayAuthzDenyEvent({
    ts: Date.now(),
    requestId: randomUUID(),
    method: params.denyMethod,
    reasonCode: "UNKNOWN_SENDER",
    errorCode: "INVALID_REQUEST",
    errorMessage: message,
    userId: null,
    principalId: null,
    actorRole: null,
    sourceRole: null,
    clientId: params.denyMethod,
    clientMode: "http",
    sourceIp,
  });
  return false;
}

export type HooksRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

export function createHooksRequestHandler(
  opts: {
    getHooksConfig: () => HooksConfigResolved | null;
    bindHost: string;
    port: number;
    logHooks: SubsystemLogger;
  } & HookDispatchers,
): HooksRequestHandler {
  const { getHooksConfig, bindHost, port, logHooks, dispatchAgentHook, dispatchWakeHook } = opts;
  return async (req, res) => {
    const hooksConfig = getHooksConfig();
    if (!hooksConfig) {
      return false;
    }
    const url = new URL(req.url ?? "/", `http://${bindHost}:${port}`);
    const basePath = hooksConfig.basePath;
    const normalizedBasePath = normalizeGatewayBoundaryPath(basePath);
    const normalizedPath = normalizeGatewayBoundaryPath(url.pathname);
    if (
      normalizedPath !== normalizedBasePath &&
      !normalizedPath.startsWith(`${normalizedBasePath}/`)
    ) {
      return false;
    }

    const cfg = loadConfig();
    const trustedProxies = cfg.gateway?.trustedProxies ?? [];
    const multiUserMode = resolveGatewayMultiUserMode(cfg);
    const sourceIp = resolveGatewayRequestSourceIp({ req, trustedProxies });
    if (multiUserMode !== "off") {
      if (!isLocalDirectRequest(req, trustedProxies)) {
        const message =
          "hooks endpoint is local-admin only while gateway.multiUser.mode is enabled";
        recordGatewayAuthzDenyEvent({
          ts: Date.now(),
          requestId: randomUUID(),
          method: "http.hooks",
          reasonCode: "ROLE_FORBIDDEN",
          errorCode: "INVALID_REQUEST",
          errorMessage: message,
          userId: null,
          principalId: null,
          actorRole: null,
          sourceRole: null,
          clientId: "http.hooks",
          clientMode: "http",
          sourceIp,
        });
        sendJson(res, 403, {
          ok: false,
          error: {
            type: "forbidden",
            message,
          },
        });
        return true;
      }
    }

    if (url.searchParams.has("token")) {
      recordGatewayAuthzDenyEvent({
        ts: Date.now(),
        requestId: randomUUID(),
        method: "http.hooks",
        reasonCode: "UNKNOWN_SENDER",
        errorCode: "INVALID_REQUEST",
        errorMessage: "hooks endpoint query token is not allowed",
        userId: null,
        principalId: null,
        actorRole: null,
        sourceRole: null,
        clientId: "http.hooks",
        clientMode: "http",
        sourceIp,
      });
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(
        "Hook token must be provided via Authorization: Bearer <token> or X-OpenClaw-Token header (query parameters are not allowed).",
      );
      return true;
    }

    const token = extractHookToken(req);
    if (!token || token !== hooksConfig.token) {
      recordGatewayAuthzDenyEvent({
        ts: Date.now(),
        requestId: randomUUID(),
        method: "http.hooks",
        reasonCode: "UNKNOWN_SENDER",
        errorCode: "INVALID_REQUEST",
        errorMessage: "hooks endpoint token missing or invalid",
        userId: null,
        principalId: null,
        actorRole: null,
        sourceRole: null,
        clientId: "http.hooks",
        clientMode: "http",
        sourceIp,
      });
      res.statusCode = 401;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Unauthorized");
      return true;
    }

    if (multiUserMode !== "off") {
      recordGatewayAuthzAllowEvent({
        ts: Date.now(),
        requestId: randomUUID(),
        method: "http.hooks",
        userId: null,
        principalId: null,
        actorRole: null,
        sourceRole: null,
        clientId: "http.hooks",
        clientMode: "http",
        sourceIp,
      });
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return true;
    }

    const subPath = normalizedPath.slice(normalizedBasePath.length).replace(/^\/+/, "");
    if (!subPath) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
      return true;
    }

    const body = await readJsonBody(req, hooksConfig.maxBodyBytes);
    if (!body.ok) {
      const status = body.error === "payload too large" ? 413 : 400;
      sendJson(res, status, { ok: false, error: body.error });
      return true;
    }

    const payload = typeof body.value === "object" && body.value !== null ? body.value : {};
    const headers = normalizeHookHeaders(req);

    if (subPath === "wake") {
      const normalized = normalizeWakePayload(payload as Record<string, unknown>);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return true;
      }
      dispatchWakeHook(normalized.value);
      sendJson(res, 200, { ok: true, mode: normalized.value.mode });
      return true;
    }

    if (subPath === "agent") {
      const normalized = normalizeAgentPayload(payload as Record<string, unknown>);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return true;
      }
      if (!isHookAgentAllowed(hooksConfig, normalized.value.agentId)) {
        sendJson(res, 400, { ok: false, error: getHookAgentPolicyError() });
        return true;
      }
      const runId = dispatchAgentHook({
        ...normalized.value,
        agentId: resolveHookTargetAgentId(hooksConfig, normalized.value.agentId),
      });
      sendJson(res, 202, { ok: true, runId });
      return true;
    }

    if (hooksConfig.mappings.length > 0) {
      try {
        const mapped = await applyHookMappings(hooksConfig.mappings, {
          payload: payload as Record<string, unknown>,
          headers,
          url,
          path: subPath,
        });
        if (mapped) {
          if (!mapped.ok) {
            sendJson(res, 400, { ok: false, error: mapped.error });
            return true;
          }
          if (mapped.action === null) {
            res.statusCode = 204;
            res.end();
            return true;
          }
          if (mapped.action.kind === "wake") {
            dispatchWakeHook({
              text: mapped.action.text,
              mode: mapped.action.mode,
            });
            sendJson(res, 200, { ok: true, mode: mapped.action.mode });
            return true;
          }
          const channel = resolveHookChannel(mapped.action.channel);
          if (!channel) {
            sendJson(res, 400, { ok: false, error: getHookChannelError() });
            return true;
          }
          if (!isHookAgentAllowed(hooksConfig, mapped.action.agentId)) {
            sendJson(res, 400, { ok: false, error: getHookAgentPolicyError() });
            return true;
          }
          const runId = dispatchAgentHook({
            message: mapped.action.message,
            name: mapped.action.name ?? "Hook",
            agentId: resolveHookTargetAgentId(hooksConfig, mapped.action.agentId),
            wakeMode: mapped.action.wakeMode,
            sessionKey: mapped.action.sessionKey ?? "",
            deliver: resolveHookDeliver(mapped.action.deliver),
            channel,
            to: mapped.action.to,
            model: mapped.action.model,
            thinking: mapped.action.thinking,
            timeoutSeconds: mapped.action.timeoutSeconds,
            allowUnsafeExternalContent: mapped.action.allowUnsafeExternalContent,
          });
          sendJson(res, 202, { ok: true, runId });
          return true;
        }
      } catch (err) {
        logHooks.warn(`hook mapping failed: ${String(err)}`);
        sendJson(res, 500, { ok: false, error: "hook mapping failed" });
        return true;
      }
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not Found");
    return true;
  };
}

export function createGatewayHttpServer(opts: {
  canvasHost: CanvasHostHandler | null;
  clients: Set<GatewayWsClient>;
  controlUiEnabled: boolean;
  controlUiBasePath: string;
  controlUiRoot?: ControlUiRootState;
  openAiChatCompletionsEnabled: boolean;
  openResponsesEnabled: boolean;
  openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
  handleHooksRequest: HooksRequestHandler;
  handlePluginRequest?: HooksRequestHandler;
  resolvedAuth: ResolvedGatewayAuth;
  tlsOptions?: TlsOptions;
}): HttpServer {
  const {
    canvasHost,
    clients,
    controlUiEnabled,
    controlUiBasePath,
    controlUiRoot,
    openAiChatCompletionsEnabled,
    openResponsesEnabled,
    openResponsesConfig,
    handleHooksRequest,
    handlePluginRequest,
    resolvedAuth,
  } = opts;
  const httpServer: HttpServer = opts.tlsOptions
    ? createHttpsServer(opts.tlsOptions, (req, res) => {
        void handleRequest(req, res);
      })
    : createHttpServer((req, res) => {
        void handleRequest(req, res);
      });

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    // Don't interfere with WebSocket upgrades; ws handles the 'upgrade' event.
    if (String(req.headers.upgrade ?? "").toLowerCase() === "websocket") {
      return;
    }

    try {
      const configSnapshot = loadConfig();
      const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
      if (await handleHooksRequest(req, res)) {
        return;
      }
      if (
        await handleToolsInvokeHttpRequest(req, res, {
          auth: resolvedAuth,
          trustedProxies,
        })
      ) {
        return;
      }
      if (await handleSlackHttpRequest(req, res)) {
        return;
      }
      if (openResponsesEnabled) {
        if (
          await handleOpenResponsesHttpRequest(req, res, {
            auth: resolvedAuth,
            config: openResponsesConfig,
            trustedProxies,
          })
        ) {
          return;
        }
      }
      if (openAiChatCompletionsEnabled) {
        if (
          await handleOpenAiHttpRequest(req, res, {
            auth: resolvedAuth,
            trustedProxies,
          })
        ) {
          return;
        }
      }
      if (canvasHost) {
        const url = new URL(req.url ?? "/", "http://localhost");
        const canvasPathMatched = isCanvasPath(url.pathname);
        if (canvasPathMatched) {
          const ok = await authorizeCanvasRequest({
            req,
            config: configSnapshot,
            auth: resolvedAuth,
            trustedProxies,
            clients,
            denyMethod: "http.canvas",
          });
          if (!ok) {
            sendUnauthorized(res);
            return;
          }
        }
        if (await handleA2uiHttpRequest(req, res)) {
          return;
        }
        if (await canvasHost.handleHttpRequest(req, res)) {
          return;
        }
        if (canvasPathMatched) {
          // Fail closed for canvas-classified HTTP paths so encoded variants cannot
          // fall through to unrelated handlers when canvas host raw path checks reject.
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Not Found");
          return;
        }
      }
      if (controlUiEnabled) {
        if (
          handleControlUiAvatarRequest(req, res, {
            basePath: controlUiBasePath,
            resolveAvatar: (agentId) => resolveAgentAvatar(configSnapshot, agentId),
          })
        ) {
          return;
        }
        if (
          handleControlUiHttpRequest(req, res, {
            basePath: controlUiBasePath,
            config: configSnapshot,
            root: controlUiRoot,
          })
        ) {
          return;
        }
      }
      if (handlePluginRequest && (await handlePluginRequest(req, res))) {
        return;
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    }
  }

  return httpServer;
}

export function attachGatewayUpgradeHandler(opts: {
  httpServer: HttpServer;
  wss: WebSocketServer;
  canvasHost: CanvasHostHandler | null;
  clients: Set<GatewayWsClient>;
  resolvedAuth: ResolvedGatewayAuth;
}) {
  const { httpServer, wss, canvasHost, clients, resolvedAuth } = opts;
  httpServer.on("upgrade", (req, socket, head) => {
    void (async () => {
      if (canvasHost) {
        const url = new URL(req.url ?? "/", "http://localhost");
        const normalizedPath = normalizeGatewayBoundaryPath(url.pathname);
        const isCanvasWsPath =
          normalizedPath === CANVAS_WS_PATH || normalizedPath.startsWith(`${CANVAS_WS_PATH}/`);
        if (isCanvasWsPath) {
          const configSnapshot = loadConfig();
          const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
          const ok = await authorizeCanvasRequest({
            req,
            config: configSnapshot,
            auth: resolvedAuth,
            trustedProxies,
            clients,
            denyMethod: "ws.canvas",
          });
          if (!ok) {
            socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
          }
          if (canvasHost.handleUpgrade(req, socket, head)) {
            return;
          }
          // Fail closed for canvas-classified WS paths so they cannot fall through
          // to the gateway WS upgrader when canvas host path matching is stricter.
          socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        if (canvasHost.handleUpgrade(req, socket, head)) {
          return;
        }
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    })().catch(() => {
      socket.destroy();
    });
  });
}
