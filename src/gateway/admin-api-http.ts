/**
 * Legacy Admin API HTTP Handler
 *
 * Backwards-compatible wrapper for the platform admin API.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { handlePlatformApiHttpRequest } from "./platform-api-http.js";

export async function handleAdminApiHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  return await handlePlatformApiHttpRequest(req, res, { prefix: "/api/v1/admin" });
}
