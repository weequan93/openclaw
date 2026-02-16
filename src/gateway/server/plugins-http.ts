import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { createSubsystemLogger } from "../../logging/subsystem.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import { loadConfig } from "../../config/config.js";
import { resolveGatewayRequestSourceIp } from "../audit-source-ip.js";
import {
  authorizeGatewayConnect,
  isLocalDirectRequest,
  type ResolvedGatewayAuth,
} from "../auth.js";
import { recordGatewayAuthzAllowEvent } from "../authz-allow-events.js";
import { recordGatewayAuthzDenyEvent } from "../authz-denied-events.js";
import { sendUnauthorized } from "../http-common.js";
import { getBearerToken, getHeader } from "../http-utils.js";
import { resolveGatewayMultiUserMode } from "../multi-user-mode.js";
import { normalizeGatewayBoundaryPath } from "../path-normalize.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

export type PluginHttpRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean>;

function recordPluginHttpDeny(params: {
  req: IncomingMessage;
  trustedProxies: string[];
  reasonCode: "ROLE_FORBIDDEN" | "UNKNOWN_SENDER";
  errorMessage: string;
}) {
  recordGatewayAuthzDenyEvent({
    ts: Date.now(),
    requestId: randomUUID(),
    method: "http.plugin",
    reasonCode: params.reasonCode,
    errorCode: "INVALID_REQUEST",
    errorMessage: params.errorMessage,
    userId: null,
    principalId: null,
    actorRole: null,
    sourceRole: null,
    clientId: "http.plugin",
    clientMode: "http",
    sourceIp: resolveGatewayRequestSourceIp({
      req: params.req,
      trustedProxies: params.trustedProxies,
    }),
  });
}

function isPluginAdminPath(pathname: string): boolean {
  const normalizedPath = normalizeGatewayBoundaryPath(pathname);
  return normalizedPath === "/api/channels" || normalizedPath.startsWith("/api/channels/");
}

export function createGatewayPluginRequestHandler(params: {
  registry: PluginRegistry;
  auth: ResolvedGatewayAuth;
  log: SubsystemLogger;
  getConfig?: () => ReturnType<typeof loadConfig>;
}): PluginHttpRequestHandler {
  const { registry, auth, log } = params;
  const getConfig = params.getConfig ?? loadConfig;
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const cfg = getConfig();
    const trustedProxies = cfg.gateway?.trustedProxies ?? [];
    const multiUserMode = resolveGatewayMultiUserMode(cfg);
    const adminPath = isPluginAdminPath(url.pathname);
    const routes = registry.httpRoutes ?? [];
    const handlers = registry.httpHandlers ?? [];
    if (multiUserMode !== "off" && adminPath && !isLocalDirectRequest(req, trustedProxies)) {
      const message =
        "plugin admin HTTP routes are local-admin only while gateway.multiUser.mode is enabled";
      recordPluginHttpDeny({
        req,
        trustedProxies,
        reasonCode: "ROLE_FORBIDDEN",
        errorMessage: message,
      });
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ok: false,
          error: {
            type: "forbidden",
            message,
          },
        }),
      );
      return true;
    }
    if (adminPath) {
      const gatewayToken = getHeader(req, "x-openclaw-token")?.trim() || getBearerToken(req) || "";
      const authResult = await authorizeGatewayConnect({
        auth,
        connectAuth: gatewayToken ? { token: gatewayToken, password: gatewayToken } : null,
        req,
        trustedProxies,
      });
      if (!authResult.ok) {
        recordPluginHttpDeny({
          req,
          trustedProxies,
          reasonCode: "UNKNOWN_SENDER",
          errorMessage: "plugin admin route token missing or invalid",
        });
        sendUnauthorized(res);
        return true;
      }
      if (multiUserMode !== "off") {
        recordGatewayAuthzAllowEvent({
          ts: Date.now(),
          requestId: randomUUID(),
          method: "http.plugin",
          userId: null,
          principalId: null,
          actorRole: null,
          sourceRole: null,
          clientId: "http.plugin",
          clientMode: "http",
          sourceIp: resolveGatewayRequestSourceIp({ req, trustedProxies }),
        });
      }
    }
    if (routes.length === 0 && handlers.length === 0) {
      return false;
    }

    if (routes.length > 0) {
      const route = routes.find((entry) => entry.path === url.pathname);
      if (route) {
        try {
          await route.handler(req, res);
          if (adminPath && res.statusCode === 401) {
            recordPluginHttpDeny({
              req,
              trustedProxies,
              reasonCode: "UNKNOWN_SENDER",
              errorMessage: "plugin admin route rejected request as unauthorized",
            });
          }
          return true;
        } catch (err) {
          log.warn(`plugin http route failed (${route.pluginId ?? "unknown"}): ${String(err)}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("Internal Server Error");
          }
          return true;
        }
      }
    }

    for (const entry of handlers) {
      try {
        const handled = await entry.handler(req, res);
        if (handled) {
          if (adminPath && res.statusCode === 401) {
            recordPluginHttpDeny({
              req,
              trustedProxies,
              reasonCode: "UNKNOWN_SENDER",
              errorMessage: "plugin admin route rejected request as unauthorized",
            });
          }
          return true;
        }
      } catch (err) {
        log.warn(`plugin http handler failed (${entry.pluginId}): ${String(err)}`);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Internal Server Error");
        }
        return true;
      }
    }
    return false;
  };
}
