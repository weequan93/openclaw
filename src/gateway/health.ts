/**
 * Health Check HTTP endpoints.
 *
 * The gateway HTTP server is built on top of `node:http` (not Express), so these
 * handlers are implemented against `IncomingMessage`/`ServerResponse`.
 */

import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { resolveStateDir } from "../config/paths.js";
import { pool } from "../infra/database/pool.js";
import { VERSION } from "../version.js";
import { sendJson, sendText } from "./http-common.js";

export interface HealthCheck {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  latency?: number;
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  checks: {
    database: HealthCheck;
    stateDir: HealthCheck;
    memory: HealthCheck;
  };
  uptime: number;
  version: string;
  timestamp: string;
}

async function checkDatabase(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    await pool.query("SELECT 1");
    return { status: "healthy", latency: Date.now() - start };
  } catch (error) {
    return {
      status: "unhealthy",
      message: error instanceof Error ? error.message : "Database connection failed",
      latency: Date.now() - start,
    };
  }
}

function checkStateDir(): HealthCheck {
  const start = Date.now();
  const dir = resolveStateDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return { status: "healthy", latency: Date.now() - start };
  } catch (error) {
    return {
      status: "unhealthy",
      message: error instanceof Error ? error.message : "State directory is not writable",
      latency: Date.now() - start,
    };
  }
}

function checkMemory(): HealthCheck {
  try {
    const usage = process.memoryUsage();
    const rssPercent = (usage.rss / (2 * 1024 * 1024 * 1024)) * 100; // assume 2GB limit
    if (rssPercent > 90) {
      return {
        status: "unhealthy",
        message: `Memory usage at ${rssPercent.toFixed(1)}%`,
      };
    }
    if (rssPercent > 75) {
      return {
        status: "degraded",
        message: `Memory usage at ${rssPercent.toFixed(1)}%`,
      };
    }
    return { status: "healthy" };
  } catch (error) {
    return {
      status: "unhealthy",
      message: error instanceof Error ? error.message : "Memory check failed",
    };
  }
}

function resolveOverallStatus(checks: HealthStatus["checks"]): HealthStatus["status"] {
  const statuses = Object.values(checks).map((check) => check.status);
  if (statuses.includes("unhealthy")) {
    return "unhealthy";
  }
  if (statuses.includes("degraded")) {
    return "degraded";
  }
  return "healthy";
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export async function handleHealthHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  let pathname = normalizePathname(url.pathname);
  if (pathname === "/api/health" || pathname.startsWith("/api/health/")) {
    pathname = `/health${pathname.slice("/api/health".length)}`;
  }
  if (pathname !== "/health" && !pathname.startsWith("/health/")) {
    return false;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendText(res, 405, "Method Not Allowed");
    return true;
  }

  res.setHeader("Cache-Control", "no-store");

  if (pathname === "/health/live") {
    sendJson(res, 200, { status: "alive", timestamp: new Date().toISOString() });
    return true;
  }

  if (pathname === "/health/ready") {
    const [database, stateDir] = await Promise.all([checkDatabase(), Promise.resolve(checkStateDir())]);
    const status =
      database.status === "healthy" && stateDir.status === "healthy" ? "ready" : "not ready";
    const statusCode = status === "ready" ? 200 : 503;
    sendJson(res, statusCode, {
      status,
      checks: { database, stateDir },
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  if (pathname === "/health") {
    const checks: HealthStatus["checks"] = {
      database: await checkDatabase(),
      stateDir: checkStateDir(),
      memory: checkMemory(),
    };
    const overallStatus = resolveOverallStatus(checks);
    const health: HealthStatus = {
      status: overallStatus,
      checks,
      uptime: process.uptime(),
      version: VERSION,
      timestamp: new Date().toISOString(),
    };
    sendJson(res, overallStatus === "unhealthy" ? 503 : 200, health);
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}
