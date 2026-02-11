import type { OpenClawApp } from "../app";
import { applySettings } from "../app-settings";
import { connectGateway } from "../app-gateway";

type TenantLoginResponse = {
  token?: string;
  user?: {
    id?: string;
    email?: string;
    role?: string;
    tenantId?: string;
    fullName?: string;
  };
  tenant?: {
    id?: string;
    name?: string;
    slug?: string;
  };
  error?: string;
};

export async function loginTenant(host: OpenClawApp) {
  if (host.tenantAuthLoading) {
    return;
  }
  const tenantSlug = host.settings.tenantSlug.trim().toLowerCase();
  const email = host.settings.tenantEmail.trim().toLowerCase();
  const password = host.password.trim();
  if (!tenantSlug || !email || !password) {
    host.tenantAuthError = "Tenant slug, email, and password are required.";
    return;
  }

  host.tenantAuthLoading = true;
  host.tenantAuthError = null;

  try {
    const res = await fetch("/api/v1/tenant/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantSlug, email, password }),
    });
    const payload = (await res.json().catch(() => ({}))) as TenantLoginResponse;
    if (!res.ok) {
      host.tenantAuthError = payload.error || `Login failed (${res.status}).`;
      return;
    }
    const token = typeof payload.token === "string" ? payload.token : "";
    if (!token) {
      host.tenantAuthError = "Login failed: missing token.";
      return;
    }
    const tenant = payload.tenant ?? {};
    const user = payload.user ?? {};

    applySettings(host, {
      ...host.settings,
      token,
      tenantSlug: tenant.slug ?? tenantSlug,
      tenantEmail: user.email ?? email,
      tenantRole: user.role ?? host.settings.tenantRole,
      tenantName: tenant.name ?? host.settings.tenantName,
      tenantId: tenant.id ?? host.settings.tenantId,
      tenantUserId: user.id ?? host.settings.tenantUserId,
      tenantUserName: user.fullName ?? host.settings.tenantUserName,
    });
    host.password = "";
    host.lastError = null;
    host.hello = null;
    connectGateway(host);
  } catch (err) {
    host.tenantAuthError = `Login failed: ${String(err)}`;
  } finally {
    host.tenantAuthLoading = false;
  }
}

export function logoutTenant(host: OpenClawApp) {
  host.client?.stop();
  host.client = null;
  host.connected = false;
  host.hello = null;
  host.lastError = null;
  host.password = "";
  host.tenantAuthError = null;
  applySettings(host, {
    ...host.settings,
    token: "",
    tenantRole: "",
    tenantName: "",
    tenantId: "",
    tenantUserId: "",
    tenantUserName: "",
  });
}
