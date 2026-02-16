import type { OpenClawConfig } from "../../config/config.js";
import type { ChannelId } from "./types.js";
import { resolveGatewayMultiUserMode } from "../../gateway/multi-user-mode.js";
import { normalizeAccountId } from "../../routing/session-key.js";

const ADMIN_SCOPE = "operator.admin";

type ChannelConfigWithAccounts = {
  configWrites?: boolean;
  accounts?: Record<string, { configWrites?: boolean }>;
};

type GatewayConfigWriteContext = {
  GatewayClientScopes?: string[];
  GatewayOwnerUserId?: string;
  GatewayOwnerPrincipalId?: string;
  GatewayOwnerRole?: string;
};

function resolveAccountConfig(accounts: ChannelConfigWithAccounts["accounts"], accountId: string) {
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  if (accountId in accounts) {
    return accounts[accountId];
  }
  const matchKey = Object.keys(accounts).find(
    (key) => key.toLowerCase() === accountId.toLowerCase(),
  );
  return matchKey ? accounts[matchKey] : undefined;
}

export function resolveChannelConfigWrites(params: {
  cfg: OpenClawConfig;
  channelId?: ChannelId | null;
  accountId?: string | null;
}): boolean {
  if (!params.channelId) {
    return true;
  }
  const channels = params.cfg.channels as Record<string, ChannelConfigWithAccounts> | undefined;
  const channelConfig = channels?.[params.channelId];
  if (!channelConfig) {
    return true;
  }
  const accountId = normalizeAccountId(params.accountId);
  const accountConfig = resolveAccountConfig(channelConfig.accounts, accountId);
  const value = accountConfig?.configWrites ?? channelConfig.configWrites;
  return value !== false;
}

function hasValue(raw: unknown): boolean {
  return typeof raw === "string" && raw.trim().length > 0;
}

function normalizeScopes(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
    .filter((scope) => scope.length > 0);
}

function normalizeOwnerRole(raw: unknown): "admin" | "user" | "node" | "service" | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const lowered = raw.trim().toLowerCase();
  if (lowered === "admin" || lowered === "user" || lowered === "node" || lowered === "service") {
    return lowered;
  }
  return undefined;
}

export function resolveGatewayConfigAdminAccess(params: {
  ctx?: GatewayConfigWriteContext | null;
  cfg?: OpenClawConfig | null;
}): boolean {
  const scopes = normalizeScopes(params.ctx?.GatewayClientScopes);
  const ownerRole = normalizeOwnerRole(params.ctx?.GatewayOwnerRole);
  const hasGatewayIdentity =
    hasValue(params.ctx?.GatewayOwnerUserId) ||
    hasValue(params.ctx?.GatewayOwnerPrincipalId) ||
    hasValue(params.ctx?.GatewayOwnerRole) ||
    scopes.length > 0;
  const multiUserMode = params.cfg ? resolveGatewayMultiUserMode(params.cfg) : "off";
  if (!hasGatewayIdentity) {
    return multiUserMode === "off";
  }
  if (!scopes.includes(ADMIN_SCOPE)) {
    return false;
  }
  if (multiUserMode === "off") {
    return true;
  }
  return ownerRole === "admin";
}
