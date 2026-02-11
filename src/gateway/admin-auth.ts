import jwt from "jsonwebtoken";
import type { UserRole } from "../models/user.js";

export type AdminTokenScope = "platform" | "tenant";

export type AdminTokenPayload = {
  sub: string;
  email: string;
  role: UserRole;
  tenantId: string;
  scope: AdminTokenScope;
};

let warnedMissingSecret = false;
let warnedLegacySecret = false;

export function getAdminJwtSecret(): string {
  const secret =
    process.env.OPENCLAW_ADMIN_JWT_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    "";
  if (secret) {
    return secret;
  }

  const legacy =
    process.env.OPENCLAW_GATEWAY_TOKEN?.trim() ||
    process.env.CLAWDBOT_GATEWAY_TOKEN?.trim() ||
    "";
  if (legacy) {
    if (!warnedLegacySecret) {
      warnedLegacySecret = true;
      console.warn(
        "[admin-auth] Using OPENCLAW_GATEWAY_TOKEN as the admin JWT secret. " +
          "Set JWT_SECRET (or OPENCLAW_ADMIN_JWT_SECRET) to avoid coupling admin tokens to the gateway token.",
      );
    }
    return legacy;
  }

  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    console.warn(
      "[admin-auth] JWT_SECRET is not set; using a dev-only JWT secret.",
    );
  }
  return "openclaw-admin-dev-secret";
}

export function signAdminToken(
  payload: AdminTokenPayload,
  expiresIn: jwt.SignOptions["expiresIn"] = "24h",
): string {
  return jwt.sign(payload, getAdminJwtSecret(), { expiresIn });
}

export function verifyAdminToken(token: string): AdminTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getAdminJwtSecret());
    if (typeof decoded !== "object" || decoded === null) {
      return null;
    }
    const payload = decoded as AdminTokenPayload;
    if (!payload.sub || !payload.role || !payload.tenantId || !payload.scope) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function verifyTenantToken(token: string): AdminTokenPayload | null {
  const payload = verifyAdminToken(token);
  if (!payload) {
    return null;
  }
  if (payload.scope !== "tenant") {
    return null;
  }
  if (payload.role === "platform_admin") {
    return null;
  }
  return payload;
}
