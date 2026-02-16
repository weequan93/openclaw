import type { GatewayBrowserClient } from "../gateway.ts";
import type { GatewayHelloOk } from "../gateway.ts";
import type {
  AuthzAllowEvent,
  AuthzAllowSummary,
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
  allowCursor?: string;
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

type SecurityAllowQuery = Omit<SecurityQuery, "cursor" | "reasonCode" | "errorCode">;

type SecurityAllowSummaryQuery = Omit<SecuritySummaryQuery, "reasonCode" | "errorCode">;
type SecurityAuditMode = "both" | "denied" | "allowed";

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
  securityAllowEvents?: AuthzAllowEvent[];
  securityAllowSummary?: AuthzAllowSummary | null;
  securityAllowError?: string | null;
  securityAllowSummaryError?: string | null;
  securityAllowNextCursor?: string | null;
  securityAllowHasMore?: boolean;
  securityAllowPinnedHistory?: boolean;
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
  securityAuditMode?: SecurityAuditMode;
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
  | "unknown-sender-24h"
  | "plugin-role-forbidden-24h"
  | "plugin-unknown-sender-24h"
  | "plugin-allow-24h"
  | "openai-role-forbidden-24h"
  | "openai-unknown-sender-24h"
  | "openai-allow-24h"
  | "openresponses-role-forbidden-24h"
  | "openresponses-unknown-sender-24h"
  | "openresponses-allow-24h"
  | "tools-role-forbidden-24h"
  | "tools-unknown-sender-24h"
  | "tools-allow-24h"
  | "hooks-role-forbidden-24h"
  | "hooks-unknown-sender-24h"
  | "hooks-allow-24h"
  | "canvas-http-role-forbidden-24h"
  | "canvas-ws-role-forbidden-24h"
  | "canvas-http-unknown-sender-24h"
  | "canvas-ws-unknown-sender-24h"
  | "canvas-http-allow-24h"
  | "canvas-ws-allow-24h";

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

function isAllowOnlyPreset(preset: SecurityPreset): boolean {
  return (
    preset === "plugin-allow-24h" ||
    preset === "openai-allow-24h" ||
    preset === "openresponses-allow-24h" ||
    preset === "tools-allow-24h" ||
    preset === "hooks-allow-24h" ||
    preset === "canvas-http-allow-24h" ||
    preset === "canvas-ws-allow-24h"
  );
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

function isUnknownMethodError(err: unknown): boolean {
  const message = String(err).toLowerCase();
  return message.includes("unknown method");
}

function parseOrder(raw: unknown): "asc" | undefined {
  return raw === "asc" ? "asc" : undefined;
}

function hasAllowSurface(state: SecurityState): boolean {
  return (
    Object.prototype.hasOwnProperty.call(state, "securityAllowEvents") ||
    Object.prototype.hasOwnProperty.call(state, "securityAllowSummary") ||
    Object.prototype.hasOwnProperty.call(state, "securityAllowError") ||
    Object.prototype.hasOwnProperty.call(state, "securityAllowSummaryError")
  );
}

function resolveSecurityAuditMode(state: SecurityState): SecurityAuditMode {
  return state.securityAuditMode === "denied" || state.securityAuditMode === "allowed"
    ? state.securityAuditMode
    : "both";
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

function resolveAllowQuery(query: SecurityQuery): SecurityAllowQuery {
  return {
    limit: query.limit,
    order: query.order,
    method: query.method,
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

function resolveAllowSummaryQuery(
  state: SecurityState,
  query: SecurityAllowQuery,
): SecurityAllowSummaryQuery {
  return {
    topN: DEFAULT_SECURITY_TOPN,
    alertThreshold:
      parseAlertThreshold(state.securityAlertThreshold) ?? DEFAULT_SECURITY_ALERT_THRESHOLD,
    method: query.method,
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
  if (state.hello === undefined) {
    return true;
  }
  const auth = state.hello?.auth;
  // Keep pre-connect compatibility, but never grant admin controls for connected
  // sessions when auth metadata is missing.
  if (!auth) {
    return state.connected !== true;
  }
  const principalRole = typeof auth.principalRole === "string" ? auth.principalRole.trim() : "";
  if (principalRole.length > 0) {
    return principalRole === "admin";
  }
  // Connected sessions without explicit principal role are treated as non-admin
  // to avoid scope-only admin UI bypass.
  if (state.connected === true) {
    return false;
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
    if (hasAllowSurface(state)) {
      state.securityAllowEvents = [];
      state.securityAllowSummary = null;
      state.securityAllowError = null;
      state.securityAllowSummaryError = null;
      state.securityAllowNextCursor = null;
      state.securityAllowHasMore = false;
      state.securityAllowPinnedHistory = false;
    }
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
  const auditMode = resolveSecurityAuditMode(state);
  const includeDeniedByMode = auditMode !== "allowed";
  const includeAllowByMode = hasAllowSurface(state) && auditMode !== "denied";
  const pagingDenied = Boolean(opts?.cursor);
  const pagingAllow = Boolean(opts?.allowCursor);
  const skipDeniedForTargetedPaging = auditMode === "both" && pagingAllow && !pagingDenied;
  const skipAllowForTargetedPaging = auditMode === "both" && pagingDenied && !pagingAllow;
  const loadDeniedFeed = includeDeniedByMode && !skipDeniedForTargetedPaging;
  const loadAllowFeed = includeAllowByMode && !skipAllowForTargetedPaging;
  state.securityLoading = true;
  if (hasAllowSurface(state)) {
    state.securityAllowError = null;
    state.securityAllowSummaryError = null;
  }
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
  if (loadDeniedFeed) {
    try {
      const queryRaw = resolveSecurityQuery(state, opts);
      const { allowCursor: _allowCursor, ...deniedQueryRaw } = queryRaw;
      const summaryQueryRaw = resolveSecuritySummaryQuery(state, deniedQueryRaw);
      const append = Boolean(opts?.cursor);
      state.securityPinnedHistory = append;
      const query = Object.fromEntries(
        Object.entries(deniedQueryRaw).filter(([, value]) => value !== undefined),
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
  } else if (!includeDeniedByMode) {
    state.securityDeniedEvents = [];
    state.securityDeniedSummary = null;
    state.securityDeniedError = null;
    state.securityDeniedSummaryError = null;
    state.securityNextCursor = null;
    state.securityHasMore = false;
    state.securityPinnedHistory = false;
  }

  if (loadAllowFeed) {
    try {
      const queryRaw = resolveSecurityQuery(state, opts);
      const allowQueryRaw = resolveAllowQuery(queryRaw);
      const appendAllow = Boolean(opts?.allowCursor);
      if (hasAllowSurface(state)) {
        state.securityAllowPinnedHistory = appendAllow;
      }
      const allowSummaryQueryRaw = resolveAllowSummaryQuery(state, allowQueryRaw);
      const allowQuery = Object.fromEntries(
        Object.entries(allowQueryRaw).filter(([, value]) => value !== undefined),
      );
      if (opts?.allowCursor) {
        allowQuery.cursor = opts.allowCursor;
      }
      const allowSummaryQuery = Object.fromEntries(
        Object.entries(allowSummaryQueryRaw).filter(([, value]) => value !== undefined),
      );
      const [allow, allowSummary] = await Promise.all([
        state.client.request("authz.allow.list", allowQuery),
        state.client.request("authz.allow.summary", allowSummaryQuery),
      ]);
      const allowPayload = allow as
        | {
            events?: unknown[];
            nextCursor?: string | null;
            hasMore?: boolean;
          }
        | undefined;
      const page = Array.isArray(allowPayload?.events)
        ? (allowPayload.events as AuthzAllowEvent[])
        : [];
      state.securityAllowEvents = appendAllow
        ? [...(state.securityAllowEvents ?? []), ...page]
        : page;
      state.securityAllowSummary = allowSummary as AuthzAllowSummary;
      if (hasAllowSurface(state)) {
        state.securityAllowNextCursor =
          typeof allowPayload?.nextCursor === "string" && allowPayload.nextCursor.trim()
            ? allowPayload.nextCursor
            : null;
        state.securityAllowHasMore =
          Boolean(allowPayload?.hasMore) && Boolean(state.securityAllowNextCursor);
      }
    } catch (err) {
      if (isUnknownMethodError(err)) {
        state.securityAllowEvents = [];
        state.securityAllowSummary = null;
        state.securityAllowError = null;
        state.securityAllowSummaryError = null;
        state.securityAllowNextCursor = null;
        state.securityAllowHasMore = false;
        state.securityAllowPinnedHistory = false;
      } else {
        state.securityAllowError = String(err);
        state.securityAllowSummaryError = String(err);
        state.securityAllowEvents = [];
        state.securityAllowSummary = null;
        state.securityAllowNextCursor = null;
        state.securityAllowHasMore = false;
        state.securityAllowPinnedHistory = false;
      }
    }
  } else if (hasAllowSurface(state) && !includeAllowByMode) {
    state.securityAllowEvents = [];
    state.securityAllowSummary = null;
    state.securityAllowError = null;
    state.securityAllowSummaryError = null;
    state.securityAllowNextCursor = null;
    state.securityAllowHasMore = false;
    state.securityAllowPinnedHistory = false;
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

function buildSecurityPagingBaseQuery(state: SecurityState): SecurityQuery {
  const limit = parseLimit(state.securityLimit) ?? DEFAULT_SECURITY_LIMIT;
  return {
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
  };
}

export async function loadOlderDeniedSecurity(state: SecurityState) {
  const cursor = state.securityNextCursor;
  if (!cursor) {
    return;
  }
  await loadSecurity(state, {
    ...buildSecurityPagingBaseQuery(state),
    cursor,
  });
}

export async function loadOlderAllowSecurity(state: SecurityState) {
  const allowCursor = state.securityAllowNextCursor;
  if (!allowCursor) {
    return;
  }
  await loadSecurity(state, {
    ...buildSecurityPagingBaseQuery(state),
    allowCursor,
  });
}

export async function loadOlderSecurityBoth(state: SecurityState) {
  const cursor = state.securityNextCursor;
  const allowCursor = state.securityAllowNextCursor;
  if (!cursor || !allowCursor) {
    return;
  }
  await loadSecurity(state, {
    ...buildSecurityPagingBaseQuery(state),
    cursor,
    allowCursor,
  });
}

export async function loadOlderSecurity(state: SecurityState) {
  const mode = resolveSecurityAuditMode(state);
  if (mode === "denied") {
    await loadOlderDeniedSecurity(state);
    return;
  }
  if (mode === "allowed") {
    await loadOlderAllowSecurity(state);
    return;
  }
  const hasDeniedCursor = Boolean(state.securityNextCursor);
  const hasAllowCursor = Boolean(state.securityAllowNextCursor);
  if (hasDeniedCursor && hasAllowCursor) {
    await loadOlderSecurityBoth(state);
    return;
  }
  if (hasDeniedCursor) {
    await loadOlderDeniedSecurity(state);
    return;
  }
  if (hasAllowCursor) {
    await loadOlderAllowSecurity(state);
  }
}

export async function applySecurityPreset(
  state: SecurityState,
  preset: SecurityPreset,
  nowMs = Date.now(),
) {
  state.securityFilterMethod = "";
  state.securityFilterReasonCode = "";
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
  state.securityAuditMode = isAllowOnlyPreset(preset) ? "allowed" : "denied";
  state.securityOrder = "desc";
  state.securityLimit = String(DEFAULT_SECURITY_LIMIT);
  state.securityAlertThreshold = String(DEFAULT_SECURITY_ALERT_THRESHOLD);
  state.securityNextCursor = null;
  state.securityHasMore = false;
  state.securityPinnedHistory = false;
  state.securityAllowNextCursor = null;
  state.securityAllowHasMore = false;
  state.securityAllowPinnedHistory = false;
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
    case "plugin-role-forbidden-24h":
      state.securityFilterMethod = "http.plugin";
      state.securityFilterReasonCode = "ROLE_FORBIDDEN";
      break;
    case "plugin-unknown-sender-24h":
      state.securityFilterMethod = "http.plugin";
      state.securityFilterReasonCode = "UNKNOWN_SENDER";
      break;
    case "plugin-allow-24h":
      state.securityFilterMethod = "http.plugin";
      break;
    case "openai-role-forbidden-24h":
      state.securityFilterMethod = "http.openai.chat.completions";
      state.securityFilterReasonCode = "ROLE_FORBIDDEN";
      break;
    case "openai-unknown-sender-24h":
      state.securityFilterMethod = "http.openai.chat.completions";
      state.securityFilterReasonCode = "UNKNOWN_SENDER";
      break;
    case "openai-allow-24h":
      state.securityFilterMethod = "http.openai.chat.completions";
      break;
    case "openresponses-role-forbidden-24h":
      state.securityFilterMethod = "http.openresponses.responses";
      state.securityFilterReasonCode = "ROLE_FORBIDDEN";
      break;
    case "openresponses-unknown-sender-24h":
      state.securityFilterMethod = "http.openresponses.responses";
      state.securityFilterReasonCode = "UNKNOWN_SENDER";
      break;
    case "openresponses-allow-24h":
      state.securityFilterMethod = "http.openresponses.responses";
      break;
    case "tools-role-forbidden-24h":
      state.securityFilterMethod = "http.tools.invoke";
      state.securityFilterReasonCode = "ROLE_FORBIDDEN";
      break;
    case "tools-unknown-sender-24h":
      state.securityFilterMethod = "http.tools.invoke";
      state.securityFilterReasonCode = "UNKNOWN_SENDER";
      break;
    case "tools-allow-24h":
      state.securityFilterMethod = "http.tools.invoke";
      break;
    case "hooks-role-forbidden-24h":
      state.securityFilterMethod = "http.hooks";
      state.securityFilterReasonCode = "ROLE_FORBIDDEN";
      break;
    case "hooks-unknown-sender-24h":
      state.securityFilterMethod = "http.hooks";
      state.securityFilterReasonCode = "UNKNOWN_SENDER";
      break;
    case "hooks-allow-24h":
      state.securityFilterMethod = "http.hooks";
      break;
    case "canvas-http-role-forbidden-24h":
      state.securityFilterMethod = "http.canvas";
      state.securityFilterReasonCode = "ROLE_FORBIDDEN";
      break;
    case "canvas-ws-role-forbidden-24h":
      state.securityFilterMethod = "ws.canvas";
      state.securityFilterReasonCode = "ROLE_FORBIDDEN";
      break;
    case "canvas-http-unknown-sender-24h":
      state.securityFilterMethod = "http.canvas";
      state.securityFilterReasonCode = "UNKNOWN_SENDER";
      break;
    case "canvas-ws-unknown-sender-24h":
      state.securityFilterMethod = "ws.canvas";
      state.securityFilterReasonCode = "UNKNOWN_SENDER";
      break;
    case "canvas-http-allow-24h":
      state.securityFilterMethod = "http.canvas";
      break;
    case "canvas-ws-allow-24h":
      state.securityFilterMethod = "ws.canvas";
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
  state.securityAllowNextCursor = null;
  state.securityAllowHasMore = false;
  state.securityAllowPinnedHistory = false;
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
