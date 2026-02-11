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

const PLATFORM_PREFIX_DEFAULT = "/api/v1/platform";
const PLATFORM_TENANT_SLUG = "platform";

type PlatformAuthContext = {
  userId: string;
  email: string;
  role: AdminTokenPayload["role"];
  tenantId: string;
  scope: "platform";
};

let platformBootstrapPromise: Promise<string> | null = null;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function ensurePlatformBootstrap(): Promise<string> {
  if (platformBootstrapPromise) {
    return platformBootstrapPromise;
  }
  platformBootstrapPromise = (async () => {
    let platformTenant = await tenantService.getTenantBySlug(PLATFORM_TENANT_SLUG);
    if (!platformTenant) {
      platformTenant = await tenantService.createTenant({
        name: "Platform",
        slug: PLATFORM_TENANT_SLUG,
        plan: "enterprise",
      });
    }

    const platformAdminCount = await pool.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = $1",
      ["platform_admin"],
    );
    const count = Number(platformAdminCount.rows[0]?.count ?? 0);
    if (count === 0) {
      const email =
        process.env.OPENCLAW_PLATFORM_ADMIN_EMAIL?.trim() || "admin@openclaw.local";
      const providedPassword = process.env.OPENCLAW_PLATFORM_ADMIN_PASSWORD?.trim();
      const password =
        providedPassword || randomBytes(12).toString("hex");
      const passwordHash = await hashPassword(password);
      const user = await userService.createUser({
        tenantId: platformTenant.id,
        email,
        fullName: "Platform Admin",
        passwordHash,
        role: "platform_admin",
      });
      if (!platformTenant.ownerId) {
        await tenantService.updateTenant(platformTenant.id, { ownerId: user.id });
      }
      if (!providedPassword) {
        console.warn(
          `[platform-admin] Default admin created: ${email} (password: ${password})`,
        );
      }
    }

    return platformTenant.id;
  })();

  return platformBootstrapPromise;
}

function buildPlatformAuthContext(
  tokenPayload: AdminTokenPayload,
): PlatformAuthContext | null {
  if (tokenPayload.scope !== "platform" || tokenPayload.role !== "platform_admin") {
    return null;
  }
  return {
    userId: tokenPayload.sub,
    email: tokenPayload.email,
    role: tokenPayload.role,
    tenantId: tokenPayload.tenantId,
    scope: "platform",
  };
}

function requirePlatformAuth(
  req: IncomingMessage,
  res: ServerResponse,
  platformTenantId: string,
): PlatformAuthContext | null {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (gatewayToken && token === gatewayToken) {
    return {
      userId: "gateway-token",
      email: "gateway-token",
      role: "platform_admin",
      tenantId: platformTenantId,
      scope: "platform",
    };
  }
  const payload = verifyAdminToken(token);
  if (!payload) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }
  const context = buildPlatformAuthContext(payload);
  if (!context) {
    sendJson(res, 403, { error: "Forbidden" });
    return null;
  }
  return context;
}

export async function handlePlatformApiHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts?: { prefix?: string },
): Promise<boolean> {
  const prefix = opts?.prefix ?? PLATFORM_PREFIX_DEFAULT;
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

  const platformTenantId = await ensurePlatformBootstrap();
  const path = url.pathname.slice(prefix.length);
  const method = req.method ?? "GET";

  if (path === "/auth/login" && method === "POST") {
    const body = await parseJsonBody(req);
    if (!body) {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return true;
    }
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) {
      sendJson(res, 400, { error: "Email and password required" });
      return true;
    }
    const user = await userService.getUserByEmailForTenant(platformTenantId, email);
    if (!user || user.role !== "platform_admin" || !user.passwordHash) {
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
      tenantId: user.tenantId,
      scope: "platform",
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
    const context = payload ? buildPlatformAuthContext(payload) : null;
    if (!context) {
      sendJson(res, 401, { error: "Unauthorized" });
      return true;
    }
    sendJson(res, 200, { user: context });
    return true;
  }

  const auth = requirePlatformAuth(req, res, platformTenantId);
  if (!auth) {
    return true;
  }

  if (path === "/stats" && method === "GET") {
    const tenantsResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM tenants WHERE status != $1",
      ["deleted"],
    );
    const usersResult = await pool.query("SELECT COUNT(*)::int AS count FROM users");
    const agentsResult = await pool.query("SELECT COUNT(*)::int AS count FROM agents");
    const sessionsResult = await pool.query("SELECT COUNT(*)::int AS count FROM sessions");

    sendJson(res, 200, {
      totals: {
        tenants: tenantsResult.rows[0]?.count ?? 0,
        users: usersResult.rows[0]?.count ?? 0,
        agents: agentsResult.rows[0]?.count ?? 0,
        sessions: sessionsResult.rows[0]?.count ?? 0,
      },
    });
    return true;
  }

  if (path === "/tenants" && method === "GET") {
    const limit = parseInt(String(url.searchParams.get("limit") || "100"), 10);
    const offset = parseInt(String(url.searchParams.get("offset") || "0"), 10);
    const tenants = await pool.query(
      `
      SELECT
        t.id,
        t.name,
        t.slug,
        t.plan,
        t.status,
        t.owner_id,
        t.created_at,
        t.updated_at,
        (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count,
        (SELECT COUNT(*) FROM agents a WHERE a.tenant_id = t.id) AS agent_count,
        (SELECT COUNT(*) FROM sessions s WHERE s.tenant_id = t.id) AS session_count
      FROM tenants t
      WHERE t.slug <> $1
      ORDER BY t.created_at DESC
      LIMIT $2 OFFSET $3
    `,
      [PLATFORM_TENANT_SLUG, limit, offset],
    );
    sendJson(res, 200, { tenants: tenants.rows });
    return true;
  }

  if (path === "/tenants" && method === "POST") {
    const body = await parseJsonBody(req);
    if (!body) {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return true;
    }
    const name = String(body.name || "").trim();
    const slug = String(body.slug || "").trim();
    const plan = String(body.plan || "starter").trim();
    const ownerEmail = String(body.ownerEmail || "").trim().toLowerCase();
    const ownerName = String(body.ownerName || "").trim();
    const ownerPassword = String(body.ownerPassword || "");
    if (!name || !slug || !ownerEmail || !ownerName) {
      sendJson(res, 400, { error: "name, slug, ownerEmail, ownerName required" });
      return true;
    }

    const tenant = await tenantService.createTenant({
      name,
      slug,
      plan,
    });

    const password = ownerPassword || randomBytes(12).toString("hex");
    const owner = await userService.createUser({
      tenantId: tenant.id,
      email: ownerEmail,
      fullName: ownerName,
      passwordHash: await hashPassword(password),
      role: "tenant_admin",
    });
    await tenantService.updateTenant(tenant.id, { ownerId: owner.id });

    if (isUuid(auth.userId)) {
      await auditService.createAuditLog({
        tenantId: tenant.id,
        userId: auth.userId,
        action: "tenant.created",
        resourceType: "tenant",
        resourceId: tenant.id,
        details: { name: tenant.name, slug: tenant.slug },
        ipAddress: req.socket.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
    }

    sendJson(res, 201, {
      tenant,
      owner: {
        id: owner.id,
        email: owner.email,
        fullName: owner.fullName,
        role: owner.role,
      },
      ownerPassword: ownerPassword ? undefined : password,
    });
    return true;
  }

  if (path.match(/^\/tenants\/[^/]+$/) && method === "PATCH") {
    const body = await parseJsonBody(req);
    if (!body) {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return true;
    }
    const id = path.split("/")[2];
    const tenant = await tenantService.updateTenant(id, body);
    sendJson(res, 200, { tenant });
    return true;
  }

  if (path.match(/^\/tenants\/[^/]+$/) && method === "DELETE") {
    const id = path.split("/")[2];
    await tenantService.deleteTenant(id);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (path === "/owners" && method === "GET") {
    const owners = await pool.query(
      `
      SELECT
        t.id AS tenant_id,
        t.name AS tenant_name,
        t.slug AS tenant_slug,
        u.id AS user_id,
        u.email,
        u.full_name
      FROM tenants t
      LEFT JOIN users u ON u.id = t.owner_id
      WHERE t.slug <> $1
      ORDER BY t.created_at DESC
    `,
      [PLATFORM_TENANT_SLUG],
    );
    sendJson(res, 200, { owners: owners.rows });
    return true;
  }

  if (path === "/platform-admins" && method === "GET") {
    const admins = await pool.query(
      `
      SELECT id, email, full_name, role, tenant_id, metadata
      FROM users
      WHERE role = $1 OR (metadata->>'platformAdminRevoked') = 'true'
      ORDER BY created_at DESC
      `,
      ["platform_admin"],
    );
    const mapped = admins.rows.map((row) => {
      const metadata = row.metadata ?? {};
      const revoked =
        metadata.platformAdminRevoked === true || metadata.platformAdminRevoked === "true";
      return {
        id: row.id,
        email: row.email,
        full_name: row.full_name,
        role: row.role,
        tenant_id: row.tenant_id,
        revoked,
        revoked_at: metadata.platformAdminRevokedAt ?? null,
      };
    });
    sendJson(res, 200, { admins: mapped });
    return true;
  }

  if (path.match(/^\/platform-admins\/[^/]+\/revoke$/) && method === "POST") {
    const id = path.split("/")[2];
    const admin = await userService.getUserById(id);
    if (!admin || admin.role !== "platform_admin") {
      sendJson(res, 404, { error: "Platform admin not found" });
      return true;
    }

    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = $1",
      ["platform_admin"],
    );
    const count = Number(countResult.rows[0]?.count ?? 0);
    if (count <= 1) {
      sendJson(res, 400, { error: "Cannot revoke the last platform admin" });
      return true;
    }

    const updated = await pool.query(
      `
      UPDATE users
      SET
        role = $1,
        password_hash = $2,
        metadata = jsonb_set(
          jsonb_set(COALESCE(metadata, '{}'::jsonb), '{platformAdminRevoked}', 'true', true),
          '{platformAdminRevokedAt}',
          to_jsonb(NOW()),
          true
        ),
        updated_at = NOW()
      WHERE id = $3
      RETURNING id, email, full_name, role, tenant_id, metadata
      `,
      ["viewer", null, id],
    );
    const updatedRow = updated.rows[0];

    if (isUuid(auth.userId)) {
      await auditService.createAuditLog({
        tenantId: platformTenantId,
        userId: auth.userId,
        action: "platform_admin.revoked",
        resourceType: "user",
        resourceId: updatedRow.id,
        details: { email: updatedRow.email },
        ipAddress: req.socket.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
    }

    const revokedAt = updatedRow.metadata?.platformAdminRevokedAt ?? null;
    sendJson(res, 200, {
      admin: {
        id: updatedRow.id,
        email: updatedRow.email,
        fullName: updatedRow.full_name,
        role: updatedRow.role,
        tenantId: updatedRow.tenant_id,
        revoked: true,
        revokedAt,
      },
    });
    return true;
  }

  if (path === "/platform-admins" && method === "POST") {
    const body = await parseJsonBody(req);
    if (!body) {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return true;
    }
    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.fullName || "").trim() || "Platform Admin";
    const password = String(body.password || "");
    if (!email || !password) {
      sendJson(res, 400, { error: "email and password required" });
      return true;
    }
    const passwordHash = await hashPassword(password);
    const admin = await userService.createUser({
      tenantId: platformTenantId,
      email,
      fullName,
      passwordHash,
      role: "platform_admin",
    });
    sendJson(res, 201, {
      admin: {
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        role: admin.role,
        tenantId: admin.tenantId,
      },
    });
    return true;
  }

  if (path === "/audit-logs" && method === "GET") {
    const tenantId = url.searchParams.get("tenantId");
    const limit = parseInt(String(url.searchParams.get("limit") || "100"), 10);
    const offset = parseInt(String(url.searchParams.get("offset") || "0"), 10);
    const params: Array<string | number> = [];
    let query = "SELECT * FROM audit_logs";
    if (tenantId) {
      params.push(tenantId);
      query += ` WHERE tenant_id = $${params.length}`;
    }
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${
      params.length + 2
    }`;
    params.push(limit, offset);
    const logs = await pool.query(query, params);
    sendJson(res, 200, { logs: logs.rows });
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}
