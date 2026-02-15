import type { OpenClawConfig } from "../config/config.js";
import { resolveGatewayMultiUserMode } from "./multi-user-mode.js";

export type GatewayDelegationResource = "agents" | "nodes" | "sessions" | "browser" | "memory";

function normalizeToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeDelegationResources(raw: unknown): Set<GatewayDelegationResource> | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const allowed = new Set<GatewayDelegationResource>();
  for (const entry of raw) {
    if (
      entry === "agents" ||
      entry === "nodes" ||
      entry === "sessions" ||
      entry === "browser" ||
      entry === "memory"
    ) {
      allowed.add(entry);
    }
  }
  return allowed.size > 0 ? allowed : null;
}

export function hasGatewayDelegatedAccess(params: {
  cfg?: OpenClawConfig;
  fromUserId?: string;
  ownerUserId?: string;
  resource: GatewayDelegationResource;
}): boolean {
  const fromUserId = normalizeToken(params.fromUserId);
  const ownerUserId = normalizeToken(params.ownerUserId);
  if (!fromUserId || !ownerUserId) {
    return false;
  }
  if (fromUserId === ownerUserId) {
    return true;
  }
  const cfg = params.cfg;
  if (resolveGatewayMultiUserMode(cfg) === "off") {
    return true;
  }
  const delegation = cfg?.gateway?.multiUser?.delegation;
  if (!delegation || delegation.enabled !== true) {
    return false;
  }
  const rules = Array.isArray(delegation.rules) ? delegation.rules : [];
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") {
      continue;
    }
    const from = normalizeToken((rule as { fromUserId?: unknown }).fromUserId);
    const to = normalizeToken((rule as { toUserId?: unknown }).toUserId);
    if (!from || !to) {
      continue;
    }
    if (from !== fromUserId || to !== ownerUserId) {
      continue;
    }
    const resources = normalizeDelegationResources(
      (rule as { resources?: unknown }).resources as unknown,
    );
    if (!resources || resources.has(params.resource)) {
      return true;
    }
  }
  return false;
}
