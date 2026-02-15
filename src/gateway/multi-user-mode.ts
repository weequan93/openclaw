import type { OpenClawConfig } from "../config/config.js";
import type { GatewayOwnerContext } from "./owner-context.js";

export type GatewayMultiUserMode = "off" | "compat" | "strict";

export const DEFAULT_GATEWAY_MULTI_USER_MODE: GatewayMultiUserMode = "strict";

function isGatewayMultiUserMode(value: unknown): value is GatewayMultiUserMode {
  return value === "off" || value === "compat" || value === "strict";
}

export function resolveGatewayMultiUserMode(cfg?: OpenClawConfig): GatewayMultiUserMode {
  const mode = cfg?.gateway?.multiUser?.mode;
  return isGatewayMultiUserMode(mode) ? mode : DEFAULT_GATEWAY_MULTI_USER_MODE;
}

export function isGatewayOwnerEnforcementEnabled(params: {
  owner?: GatewayOwnerContext | null;
  cfg?: OpenClawConfig;
}): boolean {
  const owner = params.owner;
  if (!owner || owner.role === "admin") {
    return false;
  }
  return resolveGatewayMultiUserMode(params.cfg) !== "off";
}

export function isGatewayStrictOwnerMode(cfg?: OpenClawConfig): boolean {
  return resolveGatewayMultiUserMode(cfg) === "strict";
}
