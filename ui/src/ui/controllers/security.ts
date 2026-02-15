import type { GatewayBrowserClient } from "../gateway.ts";
import type { GatewayHelloOk } from "../gateway.ts";
import type {
  AuthzDeniedEvent,
  AuthzDeniedSummary,
  ConfigChangeEvent,
  ConfigPolicyBundle,
  ConfigPolicyBundleId,
  ConfigSnapshotIssue,
  OwnershipBackfillResult,
  OwnershipGapsResult,
  OwnershipResourceName,
} from "../types.ts";

const DEFAULT_SECURITY_LIMIT = 200;
const DEFAULT_SECURITY_TOPN = 5;
const DEFAULT_SECURITY_ALERT_THRESHOLD = 5;
const DEFAULT_CONFIG_CHANGES_LIMIT = 50;
const DEFAULT_OWNERSHIP_GAPS_LIMIT = 50;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type SecurityQuery = {
  limit?: number;
  cursor?: string;
  order?: "desc" | "asc";
  method?: string;
  reasonCode?: string;
  errorCode?: string;
  userId?: string;
  principalId?: string;
  actorRole?: string;
  sourceRole?: string;
  clientId?: string;
  clientMode?: string;
  sourceIp?: string;
  sinceTs?: number;
  untilTs?: number;
};

type SecuritySummaryQuery = {
  topN?: number;
  alertThreshold?: number;
  method?: string;
  reasonCode?: string;
  errorCode?: string;
  userId?: string;
  principalId?: string;
  actorRole?: string;
  sourceRole?: string;
  clientId?: string;
  clientMode?: string;
  sourceIp?: string;
  sinceTs?: number;
  untilTs?: number;
};

type SecurityConfigChangesQuery = {
  limit?: number;
  order?: "desc" | "asc";
  method?: string;
  userId?: string;
  principalId?: string;
  actorRole?: string;
  sourceRole?: string;
  clientId?: string;
  clientMode?: string;
  sourceIp?: string;
  sinceTs?: number;
  untilTs?: number;
};

type SecurityBackfillParams = {
  dryRun?: boolean;
  resources?: string;
};

export type SecurityIdentityRoleWarning = {
  principalId: string;
  path: string;
  message: string;
};

const POLICY_BUNDLE_IDS = new Set<ConfigPolicyBundleId>([
  "single_user",
  "multi_user_isolated",
  "strict_admin_control",
]);

export type SecurityState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  hello?: GatewayHelloOk | null;
  applySessionKey?: string;
  securityLoading: boolean;
  securityDeniedEvents: AuthzDeniedEvent[];
  securityDeniedSummary?: AuthzDeniedSummary | null;
  securityDeniedError: string | null;
  securityDeniedSummaryError?: string | null;
  securityConfigChanges?: ConfigChangeEvent[];
  securityConfigChangesError?: string | null;
  securityConfigWarnings?: ConfigSnapshotIssue[];
  securityConfigWarningsError?: string | null;
  securityIdentityRoleWarnings?: SecurityIdentityRoleWarning[];
  securityOwnershipGaps: OwnershipGapsResult | null;
  securityOwnershipGapsError: string | null;
  securityNextCursor?: string | null;
  securityHasMore?: boolean;
  securityPinnedHistory?: boolean;
  securityOrder?: string;
  securityLimit?: string;
  securityAlertThreshold?: string;
  securityFilterMethod?: string;
  securityFilterReasonCode?: string;
  securityFilterErrorCode?: string;
  securityFilterUserId?: string;
  securityFilterPrincipalId?: string;
  securityFilterActorRole?: string;
  securityFilterSourceRole?: string;
  securityFilterClientId?: string;
  securityFilterClientMode?: string;
  securityFilterSourceIp?: string;
  securityFilterSinceTs?: string;
  securityFilterUntilTs?: string;
  securityBackfillBusy?: boolean;
  securityBackfillOwnerUserId?: string;
  securityBackfillOwnerPrincipalId?: string;
  securityBackfillResources?: string;
  securityBackfillResult?: OwnershipBackfillResult | null;
  securityBackfillError?: string | null;
  securityPolicyBundles?: ConfigPolicyBundle[];
  securityPolicyBundlesLoading?: boolean;
  securityPolicyBundlesError?: string | null;
  securityPolicyBundleSelectedId?: ConfigPolicyBundleId | "";
  securityPolicyBundleResolved?: ConfigPolicyBundle | null;
  securityPolicyBundleResolveLoading?: boolean;
  securityPolicyBundleResolveError?: string | null;
  securityPolicyBundleApplyBusy?: boolean;
  securityPolicyBundleApplyError?: string | null;
  securityPolicyBundleApplyMessage?: string | null;
};

export type SecurityPreset =
  | "owner-mismatch-24h"
  | "scope-missing-24h"
  | "role-forbidden-24h"
  | "policy-deny-24h"
  | "unknown-sender-24h";

export type SecurityTimePreset = "last-1h" | "last-24h" | "last-7d" | "all-time";
const OWNERSHIP_RESOURCE_NAMES = new Set<OwnershipResourceName>([
  "agents",
  "sessions",
  "nodes",
  "browserProfiles",
  "memory",
]);

function parseOptionalToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseLimit(raw: unknown): number | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.max(1, Math.min(500, Math.floor(parsed)));
}

function parseAlertThreshold(raw: unknown): number | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.max(1, Math.min(500, Math.floor(parsed)));
}

function parseEpochMs(raw: unknown): number | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function parseOrder(raw: unknown): "asc" | undefined {
  return raw === "asc" ? "asc" : undefined;
}

function hasConfigWarningSurface(state: SecurityState): boolean {
  return (
    Object.prototype.hasOwnProperty.call(state, "securityConfigWarnings") ||
    Object.prototype.hasOwnProperty.call(state, "securityConfigWarningsError")
  );
}

function hasIdentityRoleWarningSurface(state: SecurityState): boolean {
  return Object.prototype.hasOwnProperty.call(state, "securityIdentityRoleWarnings");
}

function parseConfigWarnings(raw: unknown): ConfigSnapshotIssue[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const path = (entry as { path?: unknown }).path;
    const message = (entry as { message?: unknown }).message;
    if (typeof path !== "string" || path.trim().length === 0 || typeof message !== "string") {
      return [];
    }
    return [{ path, message }];
  });
}

function parseIdentityRoleWarnings(
  warnings: ReadonlyArray<ConfigSnapshotIssue>,
): SecurityIdentityRoleWarning[] {
  const prefix = "gateway.multiUser.identities.";
  const suffix = ".role";
  const seen = new Set<string>();
  const parsed: SecurityIdentityRoleWarning[] = [];
  for (const warning of warnings) {
    if (
      typeof warning.path !== "string" ||
      !warning.path.startsWith(prefix) ||
      !warning.path.endsWith(suffix)
    ) {
      continue;
    }
    const principalId = warning.path.slice(prefix.length, -suffix.length).trim();
    if (!principalId) {
      continue;
    }
    const dedupeKey = `${principalId}\u0000${warning.message}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    parsed.push({
      principalId,
      path: warning.path,
      message: warning.message,
    });
  }
  return parsed;
}

function resolveSecurityQuery(state: SecurityState, opts?: SecurityQuery): SecurityQuery {
  if (opts) {
    return opts;
  }
  return {
    limit: parseLimit(state.securityLimit) ?? DEFAULT_SECURITY_LIMIT,
    order: parseOrder(state.securityOrder),
    method: parseOptionalToken(state.securityFilterMethod),
    reasonCode: parseOptionalToken(state.securityFilterReasonCode),
    errorCode: parseOptionalToken(state.securityFilterErrorCode),
    userId: parseOptionalToken(state.securityFilterUserId),
    principalId: parseOptionalToken(state.securityFilterPrincipalId),
    actorRole: parseOptionalToken(state.securityFilterActorRole),
    sourceRole: parseOptionalToken(state.securityFilterSourceRole),
    clientId: parseOptionalToken(state.securityFilterClientId),
    clientMode: parseOptionalToken(state.securityFilterClientMode),
    sourceIp: parseOptionalToken(state.securityFilterSourceIp),
    sinceTs: parseEpochMs(state.securityFilterSinceTs),
    untilTs: parseEpochMs(state.securityFilterUntilTs),
  };
}

function resolveSecuritySummaryQuery(
  state: SecurityState,
  query: SecurityQuery,
): SecuritySummaryQuery {
  return {
    topN: DEFAULT_SECURITY_TOPN,
    alertThreshold:
      parseAlertThreshold(state.securityAlertThreshold) ?? DEFAULT_SECURITY_ALERT_THRESHOLD,
    method: query.method,
    reasonCode: query.reasonCode,
    errorCode: query.errorCode,
    userId: query.userId,
    principalId: query.principalId,
    actorRole: query.actorRole,
    sourceRole: query.sourceRole,
    clientId: query.clientId,
    clientMode: query.clientMode,
    sourceIp: query.sourceIp,
    sinceTs: query.sinceTs,
    untilTs: query.untilTs,
  };
}

function resolveOwnershipGapsLimit(state: SecurityState): number {
  const parsed = parseLimit(state.securityLimit) ?? DEFAULT_SECURITY_LIMIT;
  return Math.max(1, Math.min(DEFAULT_OWNERSHIP_GAPS_LIMIT, parsed));
}

function resolveConfigChangesQuery(query: SecurityQuery): SecurityConfigChangesQuery {
  return {
    limit: Math.max(
      1,
      Math.min(DEFAULT_CONFIG_CHANGES_LIMIT, query.limit ?? DEFAULT_SECURITY_LIMIT),
    ),
    order: query.order,
    method: query.method?.startsWith("config.") ? query.method : undefined,
    userId: query.userId,
    principalId: query.principalId,
    actorRole: query.actorRole,
    sourceRole: query.sourceRole,
    clientId: query.clientId,
    clientMode: query.clientMode,
    sourceIp: query.sourceIp,
    sinceTs: query.sinceTs,
    untilTs: query.untilTs,
  };
}

function canManageSecurity(state: SecurityState): boolean {
  const auth = state.hello?.auth;
  // Backward compatibility for contexts without hello auth.
  if (!auth) {
    return true;
  }
  const principalRole =
    typeof auth.principalRole === "string" ? auth.principalRole.trim() : "";
  if (principalRole.length > 0) {
    return principalRole === "admin";
  }
  const role = typeof auth.role === "string" ? auth.role.trim() : "";
  const scopes = Array.isArray(auth.scopes)
    ? auth.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];
  return role === "admin" || scopes.includes("operator.admin");
}

function parseOwnershipBackfillResources(raw: unknown): OwnershipResourceName[] | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const tokens = raw
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return undefined;
  }
  const unique = Array.from(new Set(tokens));
  for (const token of unique) {
    if (!OWNERSHIP_RESOURCE_NAMES.has(token as OwnershipResourceName)) {
      throw new Error(
        `invalid ownership resource '${token}'. expected one of agents,sessions,nodes,browserProfiles,memory`,
      );
    }
  }
  return unique as OwnershipResourceName[];
}

function normalizePolicyBundle(payload: unknown): ConfigPolicyBundle | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const raw = payload as {
    id?: unknown;
    title?: unknown;
    description?: unknown;
    patch?: unknown;
  };
  if (
    typeof raw.id !== "string" ||
    !POLICY_BUNDLE_IDS.has(raw.id as ConfigPolicyBundleId) ||
    typeof raw.title !== "string" ||
    raw.title.trim().length === 0 ||
    typeof raw.description !== "string" ||
    raw.description.trim().length === 0 ||
    !raw.patch ||
    typeof raw.patch !== "object" ||
    Array.isArray(raw.patch)
  ) {
    return null;
  }
  return {
    id: raw.id as ConfigPolicyBundleId,
    title: raw.title,
    description: raw.description,
    patch: raw.patch as Record<string, unknown>,
  };
}

function parseSelectedPolicyBundleId(raw: unknown): ConfigPolicyBundleId | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!POLICY_BUNDLE_IDS.has(trimmed as ConfigPolicyBundleId)) {
    return null;
  }
  return trimmed as ConfigPolicyBundleId;
}

export async function loadSecurityPolicyBundles(state: SecurityState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (!canManageSecurity(state)) {
    state.securityPolicyBundles = [];
    state.securityPolicyBundlesError = null;
    state.securityPolicyBundlesLoading = false;
    state.securityPolicyBundleSelectedId = "";
    state.securityPolicyBundleResolved = null;
    state.securityPolicyBundleResolveLoading = false;
    state.securityPolicyBundleResolveError = null;
    state.securityPolicyBundleApplyBusy = false;
    state.securityPolicyBundleApplyError = null;
    state.securityPolicyBundleApplyMessage = null;
    return;
  }
  if (state.securityPolicyBundlesLoading) {
    return;
  }
  state.securityPolicyBundlesLoading = true;
  state.securityPolicyBundlesError = null;
  try {
    const response = await state.client.request<{
      bundles?: unknown[];
    }>("config.policyBundles.list", {});
    const bundles = Array.isArray(response?.bundles)
      ? response.bundles
          .map((bundle) => normalizePolicyBundle(bundle))
          .filter((bundle): bundle is ConfigPolicyBundle => Boolean(bundle))
      : [];
    state.securityPolicyBundles = bundles;
    if (bundles.length === 0) {
      state.securityPolicyBundleSelectedId = "";
      state.securityPolicyBundleResolved = null;
      state.securityPolicyBundleResolveError = null;
      return;
    }
    const selected = parseSelectedPolicyBundleId(state.securityPolicyBundleSelectedId);
    if (selected && bundles.some((bundle) => bundle.id === selected)) {
      return;
    }
    const firstBundleId = bundles[0].id;
    state.securityPolicyBundleSelectedId = firstBundleId;
    await resolveSecurityPolicyBundle(state, firstBundleId);
  } catch (err) {
    state.securityPolicyBundlesError = String(err);
    state.securityPolicyBundles = [];
  } finally {
    state.securityPolicyBundlesLoading = false;
  }
}

export async function resolveSecurityPolicyBundle(
  state: SecurityState,
  bundleId: ConfigPolicyBundleId,
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (!canManageSecurity(state)) {
    state.securityPolicyBundleResolveError = "requires admin principal role";
    return;
  }
  if (state.securityPolicyBundleResolveLoading) {
    return;
  }
  state.securityPolicyBundleSelectedId = bundleId;
  state.securityPolicyBundleResolveLoading = true;
  state.securityPolicyBundleResolveError = null;
  state.securityPolicyBundleApplyError = null;
  state.securityPolicyBundleApplyMessage = null;
  try {
    const response = await state.client.request<{
      bundle?: unknown;
    }>("config.policyBundle.resolve", {
      bundleId,
    });
    const bundle = normalizePolicyBundle(response?.bundle);
    if (!bundle) {
      throw new Error("invalid policy bundle response");
    }
    state.securityPolicyBundleResolved = bundle;
  } catch (err) {
    state.securityPolicyBundleResolveError = String(err);
    state.securityPolicyBundleResolved = null;
  } finally {
    state.securityPolicyBundleResolveLoading = false;
  }
}

export async function applySecurityPolicyBundle(
  state: SecurityState,
  bundleId?: ConfigPolicyBundleId,
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (!canManageSecurity(state)) {
    state.securityPolicyBundleApplyError = "requires admin principal role";
    return;
  }
  if (state.securityPolicyBundleApplyBusy) {
    return;
  }
  const selected = bundleId ?? parseSelectedPolicyBundleId(state.securityPolicyBundleSelectedId);
  if (!selected) {
    state.securityPolicyBundleApplyError = "select a policy bundle first";
    return;
  }
  state.securityPolicyBundleApplyBusy = true;
  state.securityPolicyBundleApplyError = null;
  state.securityPolicyBundleApplyMessage = null;
  try {
    if (!state.securityPolicyBundleResolved || state.securityPolicyBundleResolved.id !== selected) {
      await resolveSecurityPolicyBundle(state, selected);
    }
    const bundle = state.securityPolicyBundleResolved;
    if (!bundle || bundle.id !== selected) {
      throw new Error("failed to resolve selected policy bundle");
    }
    const snapshot = await state.client.request<{
      hash?: unknown;
    }>("config.get", {});
    const baseHash =
      typeof snapshot.hash === "string" && snapshot.hash.trim().length > 0 ? snapshot.hash : "";
    if (!baseHash) {
      throw new Error("config hash missing; reload config and retry");
    }
    const sessionKey = parseOptionalToken(state.applySessionKey);
    const note = `policy-bundle:${bundle.id}`;
    try {
      await state.client.request("config.policyBundle.apply", {
        bundleId: bundle.id,
        baseHash,
        ...(sessionKey ? { sessionKey } : {}),
        note,
      });
    } catch (err) {
      const message = String(err);
      // Backward compatibility with gateways that expose list/resolve but not apply yet.
      if (!message.toLowerCase().includes("unknown method")) {
        throw err;
      }
      await state.client.request("config.patch", {
        raw: JSON.stringify(bundle.patch, null, 2),
        baseHash,
        ...(sessionKey ? { sessionKey } : {}),
        note,
      });
    }
    state.securityPolicyBundleApplyMessage = `applied ${bundle.title}`;
    await loadSecurity(state);
  } catch (err) {
    state.securityPolicyBundleApplyError = String(err);
  } finally {
    state.securityPolicyBundleApplyBusy = false;
  }
}

export async function loadSecurity(state: SecurityState, opts?: SecurityQuery) {
  if (!state.client || !state.connected) {
    return;
  }
  if (!canManageSecurity(state)) {
    state.securityLoading = false;
    state.securityDeniedEvents = [];
    state.securityDeniedSummary = null;
    state.securityDeniedError = null;
    state.securityDeniedSummaryError = null;
    state.securityConfigChanges = [];
    state.securityConfigChangesError = null;
    if (hasConfigWarningSurface(state)) {
      state.securityConfigWarnings = [];
      state.securityConfigWarningsError = null;
    }
    if (hasIdentityRoleWarningSurface(state)) {
      state.securityIdentityRoleWarnings = [];
    }
    state.securityOwnershipGaps = null;
    state.securityOwnershipGapsError = null;
    state.securityNextCursor = null;
    state.securityHasMore = false;
    state.securityPinnedHistory = false;
    state.securityPolicyBundles = [];
    state.securityPolicyBundlesLoading = false;
    state.securityPolicyBundlesError = null;
    state.securityPolicyBundleSelectedId = "";
    state.securityPolicyBundleResolved = null;
    state.securityPolicyBundleResolveLoading = false;
    state.securityPolicyBundleResolveError = null;
    state.securityPolicyBundleApplyBusy = false;
    state.securityPolicyBundleApplyError = null;
    state.securityPolicyBundleApplyMessage = null;
    return;
  }
  if (state.securityLoading) {
    return;
  }
  state.securityLoading = true;
  state.securityDeniedError = null;
  state.securityDeniedSummaryError = null;
  state.securityConfigChangesError = null;
  if (hasConfigWarningSurface(state)) {
    state.securityConfigWarningsError = null;
  }
  state.securityOwnershipGapsError = null;
  if (
    Array.isArray(state.securityPolicyBundles) &&
    state.securityPolicyBundles.length === 0 &&
    !state.securityPolicyBundlesLoading &&
    !state.securityPolicyBundlesError
  ) {
    void loadSecurityPolicyBundles(state);
  }
  try {
    const queryRaw = resolveSecurityQuery(state, opts);
    const summaryQueryRaw = resolveSecuritySummaryQuery(state, queryRaw);
    const append = Boolean(opts?.cursor);
    state.securityPinnedHistory = append;
    const query = Object.fromEntries(
      Object.entries(queryRaw).filter(([, value]) => value !== undefined),
    );
    const summaryQuery = Object.fromEntries(
      Object.entries(summaryQueryRaw).filter(([, value]) => value !== undefined),
    );
    const [denied, summary] = await Promise.all([
      state.client.request("authz.denied.list", query),
      state.client.request("authz.denied.summary", summaryQuery),
    ]);
    const deniedPayload = denied as
      | {
          events?: unknown[];
          nextCursor?: string | null;
          hasMore?: boolean;
        }
      | undefined;
    const page = Array.isArray(deniedPayload?.events)
      ? (deniedPayload.events as AuthzDeniedEvent[])
      : [];
    state.securityDeniedEvents = append ? [...state.securityDeniedEvents, ...page] : page;
    state.securityNextCursor =
      typeof deniedPayload?.nextCursor === "string" && deniedPayload.nextCursor.trim()
        ? deniedPayload.nextCursor
        : null;
    state.securityHasMore = Boolean(deniedPayload?.hasMore) && Boolean(state.securityNextCursor);
    state.securityDeniedSummary = summary as AuthzDeniedSummary;
  } catch (err) {
    state.securityDeniedError = String(err);
    state.securityDeniedSummaryError = String(err);
    state.securityDeniedSummary = null;
  }

  try {
    const queryRaw = resolveSecurityQuery(state, opts);
    const configChangesQueryRaw = resolveConfigChangesQuery(queryRaw);
    const configChangesQuery = Object.fromEntries(
      Object.entries(configChangesQueryRaw).filter(([, value]) => value !== undefined),
    );
    const configChanges = await state.client.request("config.changes.list", configChangesQuery);
    const configPayload = configChanges as
      | {
          events?: unknown[];
        }
      | undefined;
    state.securityConfigChanges = Array.isArray(configPayload?.events)
      ? (configPayload.events as ConfigChangeEvent[])
      : [];
  } catch (err) {
    state.securityConfigChangesError = String(err);
    state.securityConfigChanges = [];
  }

  try {
    const ownershipGapsLimit = resolveOwnershipGapsLimit(state);
    const gaps = await state.client.request<OwnershipGapsResult>("ownership.gaps", {
      limit: ownershipGapsLimit,
    });
    state.securityOwnershipGaps = gaps;
  } catch (err) {
    state.securityOwnershipGapsError = String(err);
  }

  if (hasConfigWarningSurface(state)) {
    try {
      const snapshot = await state.client.request<{
        warnings?: unknown;
      }>("config.get", {});
      const warnings = parseConfigWarnings(snapshot?.warnings);
      state.securityConfigWarnings = warnings;
      state.securityConfigWarningsError = null;
      if (hasIdentityRoleWarningSurface(state)) {
        state.securityIdentityRoleWarnings = parseIdentityRoleWarnings(warnings);
      }
    } catch (err) {
      state.securityConfigWarningsError = String(err);
      state.securityConfigWarnings = [];
      if (hasIdentityRoleWarningSurface(state)) {
        state.securityIdentityRoleWarnings = [];
      }
    }
  }
  state.securityLoading = false;
}

export async function loadOlderSecurity(state: SecurityState) {
  const cursor = state.securityNextCursor;
  if (!cursor) {
    return;
  }
  const limit = parseLimit(state.securityLimit) ?? DEFAULT_SECURITY_LIMIT;
  await loadSecurity(state, {
    cursor,
    limit,
    order: parseOrder(state.securityOrder),
    method: parseOptionalToken(state.securityFilterMethod),
    reasonCode: parseOptionalToken(state.securityFilterReasonCode),
    errorCode: parseOptionalToken(state.securityFilterErrorCode),
    userId: parseOptionalToken(state.securityFilterUserId),
    principalId: parseOptionalToken(state.securityFilterPrincipalId),
    actorRole: parseOptionalToken(state.securityFilterActorRole),
    sourceRole: parseOptionalToken(state.securityFilterSourceRole),
    clientId: parseOptionalToken(state.securityFilterClientId),
    clientMode: parseOptionalToken(state.securityFilterClientMode),
    sourceIp: parseOptionalToken(state.securityFilterSourceIp),
    sinceTs: parseEpochMs(state.securityFilterSinceTs),
    untilTs: parseEpochMs(state.securityFilterUntilTs),
  });
}

export async function applySecurityPreset(
  state: SecurityState,
  preset: SecurityPreset,
  nowMs = Date.now(),
) {
  state.securityFilterMethod = "";
  state.securityFilterUserId = "";
  state.securityFilterPrincipalId = "";
  state.securityFilterErrorCode = "";
  state.securityFilterActorRole = "";
  state.securityFilterSourceRole = "";
  state.securityFilterClientId = "";
  state.securityFilterClientMode = "";
  state.securityFilterSourceIp = "";
  state.securityFilterSinceTs = String(Math.max(0, nowMs - DAY_MS));
  state.securityFilterUntilTs = String(nowMs);
  state.securityOrder = "desc";
  state.securityLimit = String(DEFAULT_SECURITY_LIMIT);
  state.securityAlertThreshold = String(DEFAULT_SECURITY_ALERT_THRESHOLD);
  state.securityNextCursor = null;
  state.securityHasMore = false;
  state.securityPinnedHistory = false;
  switch (preset) {
    case "owner-mismatch-24h":
      state.securityFilterReasonCode = "OWNER_MISMATCH";
      break;
    case "scope-missing-24h":
      state.securityFilterReasonCode = "SCOPE_MISSING";
      break;
    case "role-forbidden-24h":
      state.securityFilterReasonCode = "ROLE_FORBIDDEN";
      break;
    case "policy-deny-24h":
      state.securityFilterReasonCode = "POLICY_DENY";
      break;
    case "unknown-sender-24h":
      state.securityFilterReasonCode = "UNKNOWN_SENDER";
      break;
  }
  await loadSecurity(state);
}

export async function applySecurityTimePreset(
  state: SecurityState,
  preset: SecurityTimePreset,
  nowMs = Date.now(),
) {
  switch (preset) {
    case "all-time":
      state.securityFilterSinceTs = "";
      state.securityFilterUntilTs = "";
      break;
    case "last-1h":
      state.securityFilterSinceTs = String(Math.max(0, nowMs - HOUR_MS));
      state.securityFilterUntilTs = String(nowMs);
      break;
    case "last-24h":
      state.securityFilterSinceTs = String(Math.max(0, nowMs - DAY_MS));
      state.securityFilterUntilTs = String(nowMs);
      break;
    case "last-7d":
      state.securityFilterSinceTs = String(Math.max(0, nowMs - 7 * DAY_MS));
      state.securityFilterUntilTs = String(nowMs);
      break;
  }
  state.securityNextCursor = null;
  state.securityHasMore = false;
  state.securityPinnedHistory = false;
  await loadSecurity(state);
}

export async function runOwnershipBackfill(
  state: SecurityState,
  opts: SecurityBackfillParams = {},
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (!canManageSecurity(state)) {
    state.securityBackfillError = "requires admin principal role";
    return;
  }
  if (state.securityBackfillBusy) {
    return;
  }
  const ownerUserId = parseOptionalToken(state.securityBackfillOwnerUserId);
  if (!ownerUserId) {
    state.securityBackfillError = "owner user id is required";
    return;
  }
  state.securityBackfillBusy = true;
  state.securityBackfillError = null;
  try {
    const ownerPrincipalId = parseOptionalToken(state.securityBackfillOwnerPrincipalId);
    const resourcesRaw =
      typeof opts.resources === "string" ? opts.resources : state.securityBackfillResources;
    const resources = parseOwnershipBackfillResources(resourcesRaw);
    if (typeof opts.resources === "string") {
      state.securityBackfillResources = opts.resources;
    }
    const result = await state.client.request<OwnershipBackfillResult>("ownership.backfill", {
      ownerUserId,
      ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
      ...(resources ? { resources } : {}),
      ...(opts.dryRun === true ? { dryRun: true } : {}),
    });
    state.securityBackfillResult = result;
    await loadSecurity(state);
  } catch (err) {
    state.securityBackfillError = String(err);
  } finally {
    state.securityBackfillBusy = false;
  }
}
