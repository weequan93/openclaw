import type { WebSocket } from "ws";
import type { GatewayOwnerContext } from "../owner-context.js";
import type { ConnectParams } from "../protocol/index.js";

export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  owner?: GatewayOwnerContext;
  connId: string;
  presenceKey?: string;
  clientIp?: string;
};
