import type { IncomingMessage } from "node:http";
import { getHeader } from "./http-utils.js";
import { resolveGatewayClientIp } from "./net.js";

type AuditSourceIpInput = {
  clientIp?: string | null;
  remoteAddr?: string | null;
};

function normalizeToken(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveGatewayAuditSourceIp(input: AuditSourceIpInput): string | null {
  return normalizeToken(input.clientIp) ?? normalizeToken(input.remoteAddr);
}

export function resolveGatewayRequestSourceIp(params: {
  req: IncomingMessage;
  trustedProxies?: string[];
}): string | null {
  const remoteAddr = params.req.socket?.remoteAddress ?? "";
  const clientIp = resolveGatewayClientIp({
    remoteAddr,
    forwardedFor: getHeader(params.req, "x-forwarded-for"),
    realIp: getHeader(params.req, "x-real-ip"),
    trustedProxies: params.trustedProxies,
  });
  return resolveGatewayAuditSourceIp({ clientIp, remoteAddr });
}
