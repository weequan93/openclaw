import type { ConnectParams } from "./protocol/index.js";

const ADMIN_SCOPE = "operator.admin";

export type GatewayPrincipalRole = "admin" | "user" | "node" | "service";

export type GatewayOwnerContext = {
  userId: string;
  principalId: string;
  alias?: string;
  groupIds?: string[];
  role: GatewayPrincipalRole;
  sourceRole: "operator" | "node";
  scopes: string[];
};

function normalizeToken(raw?: string | null): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/[^a-zA-Z0-9:_-]+/g, "_");
}

function normalizeAlias(raw?: string | null): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeScopes(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(
    new Set(
      raw
        .map((scope) => (typeof scope === "string" ? scope.trim() : ""))
        .filter((scope) => scope.length > 0),
    ),
  );
}

type ConnectIdentity = {
  userId?: string;
  principalId?: string;
  alias?: string;
};

type IdentityMappingEntry = {
  userId?: string;
  principalId?: string;
  alias?: string;
  role?: string;
  groupIds?: unknown;
};

export type GatewayIdentityMappings = Record<string, IdentityMappingEntry>;

function resolveRawIdentity(connect: ConnectParams): ConnectIdentity {
  if (!connect || typeof connect !== "object") {
    return {};
  }
  const identity = (connect as ConnectParams & { identity?: ConnectIdentity }).identity;
  if (!identity || typeof identity !== "object") {
    return {};
  }
  return identity;
}

function normalizeRole(raw: unknown): GatewayPrincipalRole | undefined {
  if (raw === "admin" || raw === "user" || raw === "node" || raw === "service") {
    return raw;
  }
  return undefined;
}

function normalizeGroupIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const normalized = Array.from(
    new Set(
      raw
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0),
    ),
  );
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeKeyForLookup(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveMappingLookupKeyCandidates(raw: unknown): string[] {
  const trimmed = normalizeKeyForLookup(raw);
  if (!trimmed) {
    return [];
  }
  const normalized = normalizeToken(trimmed);
  if (!normalized || normalized === trimmed) {
    return [trimmed];
  }
  return [trimmed, normalized];
}

function resolveMappingCandidatePrincipals(params: {
  connect: ConnectParams;
  connId?: string;
}): string[] {
  const rawIdentity = resolveRawIdentity(params.connect);
  const candidates: string[] = [];
  const push = (raw: unknown) => {
    const value = normalizeKeyForLookup(raw);
    if (value && !candidates.includes(value)) {
      candidates.push(value);
    }
  };
  push(rawIdentity.principalId);
  if (params.connect.device?.id) {
    push(`device:${params.connect.device.id}`);
  }
  const clientId = normalizeKeyForLookup(params.connect.client?.id) ?? "unknown";
  const instanceId = normalizeKeyForLookup(params.connect.client?.instanceId) ?? "default";
  push(`client:${clientId}:${instanceId}`);
  return candidates;
}

type ResolvedMappedIdentity = {
  userId: string;
  principalId: string;
  alias?: string;
  role?: GatewayPrincipalRole;
  groupIds?: string[];
};

function resolveMappedIdentity(params: {
  connect: ConnectParams;
  connId?: string;
  mappings?: GatewayIdentityMappings;
}): ResolvedMappedIdentity | null {
  const mappings = params.mappings;
  if (!mappings || typeof mappings !== "object") {
    return null;
  }

  const candidatePrincipals = resolveMappingCandidatePrincipals({
    connect: params.connect,
    connId: params.connId,
  });
  for (const principalCandidate of candidatePrincipals) {
    const candidateKeys = resolveMappingLookupKeyCandidates(principalCandidate);
    for (const key of candidateKeys) {
      const rawEntry = mappings[key];
      if (!rawEntry || typeof rawEntry !== "object") {
        continue;
      }
      const mappedUserId = normalizeToken(rawEntry.userId);
      if (!mappedUserId) {
        continue;
      }
      const mappedPrincipalId =
        normalizeToken(rawEntry.principalId) ?? normalizeToken(principalCandidate);
      if (!mappedPrincipalId) {
        continue;
      }
      return {
        userId: mappedUserId,
        principalId: mappedPrincipalId,
        alias: normalizeAlias(rawEntry.alias),
        role: normalizeRole(rawEntry.role),
        groupIds: normalizeGroupIds(rawEntry.groupIds),
      };
    }
  }
  return null;
}

export function hasExplicitConnectIdentity(connect: ConnectParams): boolean {
  const identity = resolveRawIdentity(connect);
  return Boolean(normalizeToken(identity.userId) && normalizeToken(identity.principalId));
}

export function hasConnectSenderIdentity(
  connect: ConnectParams,
  params?: { connId?: string; mappings?: GatewayIdentityMappings; allowExplicitIdentity?: boolean },
): boolean {
  const allowExplicitIdentity = params?.allowExplicitIdentity !== false;
  if (allowExplicitIdentity && hasExplicitConnectIdentity(connect)) {
    return true;
  }
  const mapped = resolveMappedIdentity({
    connect,
    connId: params?.connId,
    mappings: params?.mappings,
  });
  if (mapped) {
    return true;
  }
  return Boolean(normalizeToken(connect.device?.id));
}

export function resolveConnectOwnerContext(params: {
  connect: ConnectParams;
  connId?: string;
  mappings?: GatewayIdentityMappings;
  allowExplicitIdentity?: boolean;
}): GatewayOwnerContext {
  const connect = params.connect;
  const rawIdentity = resolveRawIdentity(connect);
  const allowExplicitIdentity = params.allowExplicitIdentity !== false;
  const sourceRole = connect.role === "node" ? "node" : "operator";
  const scopes = normalizeScopes(connect.scopes);
  const mappedIdentity = resolveMappedIdentity({
    connect,
    connId: params.connId,
    mappings: params.mappings,
  });
  let effectiveRole: GatewayPrincipalRole = sourceRole === "node" ? "node" : "user";
  if (sourceRole !== "node") {
    const mappedRole = mappedIdentity?.role;
    if (mappedRole === "user" || mappedRole === "service") {
      effectiveRole = mappedRole;
    } else if (mappedRole === "admin") {
      // Never elevate to admin without operator.admin scope.
      if (scopes.includes(ADMIN_SCOPE)) {
        effectiveRole = "admin";
      }
    } else if (!mappedIdentity && scopes.includes(ADMIN_SCOPE)) {
      // Keep legacy admin-scope behavior for non-mapped principals.
      effectiveRole = "admin";
    }
  }
  const deviceId = normalizeToken(connect.device?.id);
  const instanceId = normalizeToken(connect.client?.instanceId);
  const clientId = normalizeToken(connect.client?.id) ?? "unknown";
  const explicitUserId = allowExplicitIdentity ? normalizeToken(rawIdentity.userId) : undefined;
  const explicitPrincipalId = allowExplicitIdentity
    ? normalizeToken(rawIdentity.principalId)
    : undefined;
  const explicitAlias = allowExplicitIdentity ? normalizeAlias(rawIdentity.alias) : undefined;
  const userId =
    mappedIdentity?.userId ??
    explicitUserId ??
    deviceId ??
    `legacy:${sourceRole}:${clientId}:${instanceId ?? normalizeToken(params.connId) ?? "default"}`;
  const principalId =
    mappedIdentity?.principalId ??
    explicitPrincipalId ??
    (deviceId ? `device:${deviceId}` : `client:${clientId}:${instanceId ?? "default"}`);
  const alias =
    mappedIdentity?.alias ??
    explicitAlias ??
    normalizeAlias(connect.client?.displayName);
  const groupIds = mappedIdentity?.groupIds;
  return {
    userId,
    principalId,
    alias,
    ...(groupIds ? { groupIds } : {}),
    role: effectiveRole,
    sourceRole,
    scopes,
  };
}
