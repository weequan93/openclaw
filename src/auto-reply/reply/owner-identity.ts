import type { GatewayOwnerIdentity } from "../../agents/tools/sessions-helpers.js";
import type { MsgContext } from "../templating.js";
import type { HandleCommandsParams } from "./commands-types.js";

export type GatewayOwnerRole = "admin" | "user" | "node" | "service";

export function resolveGatewayOwnerRoleFromContext(
  ctx: Pick<MsgContext, "GatewayOwnerRole">,
): GatewayOwnerRole | undefined {
  if (typeof ctx.GatewayOwnerRole !== "string") {
    return undefined;
  }
  const lowered = ctx.GatewayOwnerRole.trim().toLowerCase();
  if (lowered === "admin" || lowered === "user" || lowered === "node" || lowered === "service") {
    return lowered;
  }
  return undefined;
}

export function resolveCommandGatewayOwnerIdentity(
  params: Pick<HandleCommandsParams, "sessionEntry" | "ctx">,
): GatewayOwnerIdentity | undefined {
  const ownerUserId =
    typeof params.sessionEntry?.ownerUserId === "string" && params.sessionEntry.ownerUserId.trim()
      ? params.sessionEntry.ownerUserId.trim()
      : typeof params.ctx.GatewayOwnerUserId === "string" && params.ctx.GatewayOwnerUserId.trim()
        ? params.ctx.GatewayOwnerUserId.trim()
        : undefined;
  if (!ownerUserId) {
    return undefined;
  }
  const ownerPrincipalId =
    typeof params.sessionEntry?.ownerPrincipalId === "string" &&
    params.sessionEntry.ownerPrincipalId.trim()
      ? params.sessionEntry.ownerPrincipalId.trim()
      : typeof params.ctx.GatewayOwnerPrincipalId === "string" &&
          params.ctx.GatewayOwnerPrincipalId.trim()
        ? params.ctx.GatewayOwnerPrincipalId.trim()
        : `user:${ownerUserId}`;
  const ownerAlias =
    typeof params.ctx.GatewayOwnerAlias === "string" && params.ctx.GatewayOwnerAlias.trim()
      ? params.ctx.GatewayOwnerAlias.trim()
      : undefined;
  return {
    userId: ownerUserId,
    principalId: ownerPrincipalId,
    ...(ownerAlias ? { alias: ownerAlias } : {}),
  };
}
