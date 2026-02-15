import { callGateway } from "../../gateway/call.js";
import {
  classifyGatewayMethodAccess,
  resolveGatewayOperatorScopesForMethod,
} from "../../gateway/operator-scopes.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";

export const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";

export type GatewayCallOptions = {
  gatewayUrl?: string;
  gatewayToken?: string;
  timeoutMs?: number;
  ownerUserId?: string;
  ownerPrincipalId?: string;
  ownerAlias?: string;
};

type GatewayCallExtra = {
  expectFinal?: boolean;
  allowAdmin?: boolean;
  scopes?: string[];
};

export function resolveGatewayOptions(opts?: GatewayCallOptions) {
  // Prefer an explicit override; otherwise let callGateway choose based on config.
  const url =
    typeof opts?.gatewayUrl === "string" && opts.gatewayUrl.trim()
      ? opts.gatewayUrl.trim()
      : undefined;
  const token =
    typeof opts?.gatewayToken === "string" && opts.gatewayToken.trim()
      ? opts.gatewayToken.trim()
      : undefined;
  const timeoutMs =
    typeof opts?.timeoutMs === "number" && Number.isFinite(opts.timeoutMs)
      ? Math.max(1, Math.floor(opts.timeoutMs))
      : 30_000;
  const ownerUserId =
    typeof opts?.ownerUserId === "string" && opts.ownerUserId.trim()
      ? opts.ownerUserId.trim()
      : undefined;
  const ownerPrincipalId =
    typeof opts?.ownerPrincipalId === "string" && opts.ownerPrincipalId.trim()
      ? opts.ownerPrincipalId.trim()
      : undefined;
  const ownerAlias =
    typeof opts?.ownerAlias === "string" && opts.ownerAlias.trim()
      ? opts.ownerAlias.trim()
      : undefined;
  return { url, token, timeoutMs, ownerUserId, ownerPrincipalId, ownerAlias };
}

export async function callGatewayTool<T = Record<string, unknown>>(
  method: string,
  opts: GatewayCallOptions,
  params?: unknown,
  extra?: GatewayCallExtra,
) {
  const gateway = resolveGatewayOptions(opts);
  const identity = gateway.ownerUserId
    ? {
        userId: gateway.ownerUserId,
        principalId: gateway.ownerPrincipalId ?? `user:${gateway.ownerUserId}`,
        ...(gateway.ownerAlias ? { alias: gateway.ownerAlias } : {}),
      }
    : undefined;
  const explicitScopes = Array.isArray(extra?.scopes)
    ? extra.scopes
        .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
        .filter((scope) => scope.length > 0)
    : [];
  const scopes =
    explicitScopes.length > 0
      ? Array.from(new Set(explicitScopes))
      : (() => {
          const accessClass = classifyGatewayMethodAccess(method);
          if (accessClass === "admin" && extra?.allowAdmin !== true) {
            throw new Error(
              `gateway method '${method}' requires admin scope; pass allowAdmin=true for trusted control-plane calls`,
            );
          }
          return resolveGatewayOperatorScopesForMethod(method);
        })();
  return await callGateway<T>({
    url: gateway.url,
    token: gateway.token,
    method,
    params,
    timeoutMs: gateway.timeoutMs,
    ...(identity ? { identity } : {}),
    expectFinal: extra?.expectFinal,
    scopes,
    clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
    clientDisplayName: "agent",
    mode: GATEWAY_CLIENT_MODES.BACKEND,
  });
}
