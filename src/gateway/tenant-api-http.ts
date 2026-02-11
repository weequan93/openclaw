import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";
import { pool } from "../infra/database/pool.js";
import tenantService from "../services/tenant-service.js";
import userService from "../services/user-service.js";
import auditService from "../services/audit-log-service.js";
import { hashPassword, verifyPassword } from "../infra/auth/passwords.js";
import { getBearerToken, parseJsonBody, sendJson } from "./admin-api-utils.js";
import { signAdminToken, verifyAdminToken, type AdminTokenPayload } from "./admin-auth.js";

const TENANT_PREFIX_DEFAULT = "/api/v1/tenant";

type TenantAuthContext = {
  userId: string;
  email: string;
  role: AdminTokenPayload["role"];
  tenantId: string;
  scope: "tenant";
};

function buildTenantAuthContext(payload: AdminTokenPayload): TenantAuthContext | null {
  if (payload.scope !== "tenant" || payload.role !== "tenant_admin") {
    return null;
  }
  return {
    userId: payload.sub,
    email: payload.email,
    role: payload.role,
    tenantId: payload.tenantId,
    scope: "tenant",
  };
}

function requireTenantAuth(req: IncomingMessage, res: ServerResponse): TenantAuthContext | null {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }
  const payload = verifyAdminToken(token);
  if (!payload) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }
  const context = buildTenantAuthContext(payload);
  if (!context) {
    sendJson(res, 403, { error: "Forbidden" });
    return null;
  }
  return context;
}

export async function handleTenantApiHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts?: { prefix?: string },
): Promise<boolean> {
  const prefix = opts?.prefix ?? TENANT_PREFIX_DEFAULT;
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (!url.pathname.startsWith(prefix)) {
    return false;
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.end();
    return true;
  }

  const path = url.pathname.slice(prefix.length);
  const method = req.method ?? "GET";

  if (path === "/auth/login" && method === "POST") {
    const body = await parseJsonBody(req);
    if (!body) {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return true;
    }
    const tenantSlug = String(body.tenantSlug || "").trim().toLowerCase();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!tenantSlug || !email || !password) {
      sendJson(res, 400, { error: "tenantSlug, email, password required" });
      return true;
    }
    const tenant = await tenantService.getTenantBySlug(tenantSlug);
    if (!tenant) {
      sendJson(res, 404, { error: "Tenant not found" });
      return true;
    }
    const user = await userService.getUserByEmailForTenant(tenant.id, email);
    const allowedRoles = new Set([
      "tenant_admin",
      "owner",
      "admin",
      "developer",
      "operator",
      "viewer",
    ]);
    if (!user || !allowedRoles.has(user.role) || !user.passwordHash) {
      sendJson(res, 401, { error: "Invalid credentials" });
      return true;
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      sendJson(res, 401, { error: "Invalid credentials" });
      return true;
    }
    const token = signAdminToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: tenant.id,
      scope: "tenant",
    });
    sendJson(res, 200, {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        fullName: user.fullName,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
        settings: tenant.settings ?? {},
      },
    });
    return true;
  }

  if (path === "/auth/me" && method === "GET") {
    const token = getBearerToken(req);
    if (!token) {
      sendJson(res, 401, { error: "Unauthorized" });
      return true;
    }
    const payload = verifyAdminToken(token);
    const context = payload ? buildTenantAuthContext(payload) : null;
    if (!context) {
      sendJson(res, 401, { error: "Unauthorized" });
      return true;
    }
    sendJson(res, 200, { user: context });
    return true;
  }

  const auth = requireTenantAuth(req, res);
  if (!auth) {
    return true;
  }

  if (path === "/stats" && method === "GET") {
    const usersResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE tenant_id = $1",
      [auth.tenantId],
    );
    const agentsResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM agents WHERE tenant_id = $1",
      [auth.tenantId],
    );
    const sessionsResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM sessions WHERE tenant_id = $1",
      [auth.tenantId],
    );
    sendJson(res, 200, {
      totals: {
        users: usersResult.rows[0]?.count ?? 0,
        agents: agentsResult.rows[0]?.count ?? 0,
        sessions: sessionsResult.rows[0]?.count ?? 0,
      },
    });
    return true;
  }

  if (path === "/tenant" && method === "GET") {
    const tenant = await tenantService.getTenantById(auth.tenantId);
    if (!tenant) {
      sendJson(res, 404, { error: "Tenant not found" });
      return true;
    }
    sendJson(res, 200, { tenant });
    return true;
  }

  if (path === "/tenant" && method === "PATCH") {
    const body = await parseJsonBody(req);
    if (!body) {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return true;
    }
    const name = typeof body.name === "string" ? body.name : undefined;
    const settings =
      typeof body.settings === "object" && body.settings !== null
        ? (body.settings as Record<string, unknown>)
        : undefined;
    const tenant = await tenantService.updateTenant(auth.tenantId, {
      name,
      settings,
    });
    sendJson(res, 200, { tenant });
    return true;
  }

  if (path === "/users" && method === "GET") {
    const users = await userService.listUsersForTenant(auth.tenantId);
    sendJson(res, 200, {
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
      })),
    });
    return true;
  }

  if (path === "/users" && method === "POST") {
    const body = await parseJsonBody(req);
    if (!body) {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return true;
    }
    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.fullName || "").trim();
    const role = String(body.role || "viewer");
    const password = String(body.password || "");
    if (!email || !fullName) {
      sendJson(res, 400, { error: "email and fullName required" });
      return true;
    }
    const finalPassword = password || randomPassword();
    const allowedRoles = new Set([
      "tenant_admin",
      "admin",
      "developer",
      "operator",
      "viewer",
    ]);
    if (!allowedRoles.has(role)) {
      sendJson(res, 400, { error: "Invalid role" });
      return true;
    }

    const user = await userService.createUser({
      tenantId: auth.tenantId,
      email,
      fullName,
      passwordHash: await hashPassword(finalPassword),
      role: role as AdminTokenPayload["role"],
    });

    await auditService.createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "user.created",
      resourceType: "user",
      resourceId: user.id,
      details: { email: user.email, role: user.role },
      ipAddress: req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    });

    sendJson(res, 201, {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
      },
      tempPassword: password ? undefined : finalPassword,
    });
    return true;
  }

  if (path === "/audit-logs" && method === "GET") {
    const limit = parseInt(String(url.searchParams.get("limit") || "100"), 10);
    const offset = parseInt(String(url.searchParams.get("offset") || "0"), 10);
    const logs = await pool.query(
      "SELECT * FROM audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [auth.tenantId, limit, offset],
    );
    sendJson(res, 200, { logs: logs.rows });
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}

function randomPassword(): string {
  return randomBytes(12).toString("hex");
}
