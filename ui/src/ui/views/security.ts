import { html, nothing } from "lit";
import type {
  AuthzAllowEvent,
  AuthzAllowSummary,
  AuthzDeniedEvent,
  AuthzDeniedSummary,
  ConfigPolicyBundle,
  ConfigPolicyBundleId,
  ConfigSnapshotIssue,
  OwnershipBackfillResult,
  OwnershipGapsResult,
} from "../types.ts";

export type SecurityFilterState = {
  order: "desc" | "asc";
  limit: string;
  alertThreshold: string;
  method: string;
  reasonCode: string;
  errorCode: string;
  userId: string;
  principalId: string;
  actorRole: string;
  sourceRole: string;
  clientId: string;
  clientMode: string;
  sourceIp: string;
  sinceTs: string;
  untilTs: string;
};

export type SecurityBackfillState = {
  ownerUserId: string;
  ownerPrincipalId: string;
  resources: string;
  confirmText: string;
};

type SecurityConfigChangeEntry = {
  ts: number;
  requestId: string;
  method: string;
  path: string;
  userId: string | null;
  userAlias?: string | null;
  principalId: string | null;
  actorRole: string | null;
  sourceRole: string | null;
  clientId?: string | null;
  clientMode?: string | null;
  sourceIp?: string | null;
  sessionKey?: string | null;
  note?: string | null;
  restartDelayMs?: number | null;
};

type SecurityIdentityRoleWarning = {
  principalId: string;
  path: string;
  message: string;
};

type SecurityPresetKey =
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

type SecurityTimePresetKey = "last-1h" | "last-24h" | "last-7d" | "all-time";
type SecurityAuditModeKey = "both" | "denied" | "allowed";

export type SecurityProps = {
  loading: boolean;
  canManageBackfill: boolean;
  authRole: string | null;
  authPrincipalRole: string | null;
  authScopes: string[];
  allowEvents: AuthzAllowEvent[];
  allowSummary: AuthzAllowSummary | null;
  allowError: string | null;
  allowSummaryError: string | null;
  allowHasMore: boolean;
  allowNextCursor: string | null;
  deniedEvents: AuthzDeniedEvent[];
  deniedSummary: AuthzDeniedSummary | null;
  deniedError: string | null;
  deniedSummaryError: string | null;
  configChanges: SecurityConfigChangeEntry[];
  configChangesError: string | null;
  configWarnings: ConfigSnapshotIssue[];
  configWarningsError: string | null;
  identityRoleWarnings: SecurityIdentityRoleWarning[];
  ownershipGaps: OwnershipGapsResult | null;
  ownershipGapsError: string | null;
  backfillBusy: boolean;
  backfill: SecurityBackfillState;
  backfillResult: OwnershipBackfillResult | null;
  backfillError: string | null;
  policyBundles: ConfigPolicyBundle[];
  policyBundlesLoading: boolean;
  policyBundlesError: string | null;
  policyBundleSelectedId: ConfigPolicyBundleId | "";
  policyBundleResolved: ConfigPolicyBundle | null;
  policyBundleResolveLoading: boolean;
  policyBundleResolveError: string | null;
  policyBundleApplyBusy: boolean;
  policyBundleApplyError: string | null;
  policyBundleApplyMessage: string | null;
  hasMore: boolean;
  nextCursor: string | null;
  auditMode: SecurityAuditModeKey;
  activePreset: string | null;
  activeTimePreset: string | null;
  filters: SecurityFilterState;
  onFiltersChange: (next: SecurityFilterState) => void;
  onApplyPreset: (preset: SecurityPresetKey) => void;
  onApplyTimePreset: (preset: SecurityTimePresetKey) => void;
  onAuditModeChange: (mode: SecurityAuditModeKey) => void;
  onResetFilters: () => void;
  onRefresh: () => void;
  onLoadOlder: () => void;
  onLoadOlderDenied: () => void;
  onLoadOlderAllow: () => void;
  onBackfillChange: (next: SecurityBackfillState) => void;
  onRunBackfill: (opts: { dryRun: boolean; resources?: string }) => void;
  onPolicyBundlesRefresh: () => void;
  onPolicyBundleSelect: (bundleId: ConfigPolicyBundleId | "") => void;
  onPolicyBundleApply: (bundleId: ConfigPolicyBundleId) => void;
  onExport: (events: AuthzDeniedEvent[], label: string) => void;
  onExportDeniedSummary: (summary: AuthzDeniedSummary, label: string) => void;
  onExportAllow: (events: AuthzAllowEvent[], label: string) => void;
  onExportAllowSummary: (summary: AuthzAllowSummary, label: string) => void;
  onExportConfigChanges: (events: SecurityConfigChangeEntry[], label: string) => void;
  onExportOwnershipGaps: (gaps: OwnershipGapsResult, label: string) => void;
};

function formatDenyEventTs(ts: number): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return "unknown-time";
  }
  return date.toLocaleString();
}

function formatPolicyBundlePatch(bundle: ConfigPolicyBundle | null): string {
  if (!bundle) {
    return "{}";
  }
  try {
    return JSON.stringify(bundle.patch, null, 2);
  } catch {
    return "{}";
  }
}

export function renderSecurity(props: SecurityProps) {
  const limit = props.filters.limit.trim();
  const hasCustomLimit = limit.length > 0 && limit !== "200";
  const alertThreshold = props.filters.alertThreshold.trim();
  const hasCustomAlertThreshold = alertThreshold.length > 0 && alertThreshold !== "5";
  const hasFilters =
    props.filters.order === "asc" ||
    hasCustomAlertThreshold ||
    props.filters.method.trim().length > 0 ||
    props.filters.reasonCode.trim().length > 0 ||
    props.filters.errorCode.trim().length > 0 ||
    props.filters.userId.trim().length > 0 ||
    props.filters.principalId.trim().length > 0 ||
    props.filters.actorRole.trim().length > 0 ||
    props.filters.sourceRole.trim().length > 0 ||
    props.filters.clientId.trim().length > 0 ||
    props.filters.clientMode.trim().length > 0 ||
    props.filters.sourceIp.trim().length > 0 ||
    props.filters.sinceTs.trim().length > 0 ||
    props.filters.untilTs.trim().length > 0 ||
    hasCustomLimit;

  const reasonCounts = props.deniedSummary?.byReasonCode ?? [];
  const methodCounts = props.deniedSummary?.byMethod ?? [];
  const topReasons = reasonCounts.slice(0, 4);
  const topMethods = methodCounts.slice(0, 3);
  const topPrincipals = props.deniedSummary?.byPrincipalId.slice(0, 3) ?? [];
  const topSourceIps = props.deniedSummary?.bySourceIp?.slice(0, 3) ?? [];
  const highFrequencyThreshold = props.deniedSummary?.highFrequency.threshold;
  const highFrequencyPrincipals = props.deniedSummary?.highFrequency.principals ?? [];
  const highFrequencySourceIps = props.deniedSummary?.highFrequency.sourceIps ?? [];
  const summaryTotal = props.deniedSummary?.total ?? props.deniedEvents.length;
  const summaryEarliestTs = props.deniedSummary?.earliestTs;
  const summaryLatestTs = props.deniedSummary?.latestTs;
  const allowMethodCounts = props.allowSummary?.byMethod ?? [];
  const allowTopMethods = allowMethodCounts.slice(0, 3);
  const allowTopPrincipals = props.allowSummary?.byPrincipalId.slice(0, 3) ?? [];
  const allowTopSourceIps = props.allowSummary?.bySourceIp.slice(0, 3) ?? [];
  const allowHighFrequencyThreshold = props.allowSummary?.highFrequency.threshold;
  const allowHighFrequencyPrincipals = props.allowSummary?.highFrequency.principals ?? [];
  const allowHighFrequencySourceIps = props.allowSummary?.highFrequency.sourceIps ?? [];
  const allowSummaryTotal = props.allowSummary?.total ?? props.allowEvents.length;
  const allowSummaryEarliestTs = props.allowSummary?.earliestTs;
  const allowSummaryLatestTs = props.allowSummary?.latestTs;
  const ownershipSummary = props.ownershipGaps?.summary;
  const ownershipResources = props.ownershipGaps?.resourcesSummary;
  const hasBackfillOwnerUserId = props.backfill.ownerUserId.trim().length > 0;
  const applyResources = props.backfill.resources.trim();
  const requiresApplyPhrase = applyResources.length === 0;
  const hasApplyPhrase = props.backfill.confirmText.trim() === "APPLY";
  const authScopesLabel = props.authScopes.length > 0 ? props.authScopes.join(", ") : "none";
  const authRoleLabel = props.authRole ?? "unknown";
  const authPrincipalRoleLabel = props.authPrincipalRole ?? "unknown";
  const policyBundlePatch = formatPolicyBundlePatch(props.policyBundleResolved);
  const showDenied = props.auditMode !== "allowed";
  const showAllowed = props.auditMode !== "denied";
  const hasMoreForMode =
    props.auditMode === "allowed"
      ? props.allowHasMore
      : props.auditMode === "denied"
        ? props.hasMore
        : props.hasMore || props.allowHasMore;
  const nextCursorEntries =
    props.auditMode === "allowed"
      ? props.allowHasMore && props.allowNextCursor
        ? [{ label: "allow", cursor: props.allowNextCursor }]
        : []
      : props.auditMode === "denied"
        ? props.hasMore && props.nextCursor
          ? [{ label: "denied", cursor: props.nextCursor }]
          : []
        : [
            ...(props.hasMore && props.nextCursor
              ? [{ label: "denied", cursor: props.nextCursor }]
              : []),
            ...(props.allowHasMore && props.allowNextCursor
              ? [{ label: "allow", cursor: props.allowNextCursor }]
              : []),
          ];
  const deniedFeedStatus = showDenied
    ? `denied: ${props.deniedEvents.length} loaded${props.hasMore ? " · more" : " · end"}`
    : "denied: hidden";
  const allowFeedStatus = showAllowed
    ? `allow: ${props.allowEvents.length} loaded${props.allowHasMore ? " · more" : " · end"}`
    : "allow: hidden";

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Access Audit Events</div>
          <div class="card-sub">Filter controls for denied and allowed authorization audit feeds.</div>
        </div>
        <div class="row" style="gap: 8px;">
          <div class="pill ${props.canManageBackfill ? "" : "warn"}">
            <span>Backfill access</span>
            <span class="mono">${props.canManageBackfill ? "admin" : "restricted"}</span>
          </div>
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <div class="filters" style="margin-top: 12px;">
        <label class="field" style="min-width: 150px;">
          <span>Order</span>
          <select
            .value=${props.filters.order}
            @change=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                order: (e.target as HTMLSelectElement).value as "desc" | "asc",
              })}
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </label>
        <label class="field" style="min-width: 120px;">
          <span>Limit</span>
          <input
            .value=${props.filters.limit}
            @input=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                limit: (e.target as HTMLInputElement).value,
              })}
            placeholder="200"
          />
        </label>
        <label class="field" style="min-width: 160px;">
          <span>Alert threshold</span>
          <input
            .value=${props.filters.alertThreshold}
            @input=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                alertThreshold: (e.target as HTMLInputElement).value,
              })}
            placeholder="5"
          />
        </label>
        <label class="field" style="min-width: 160px;">
          <span>Audit feed</span>
          <select
            .value=${props.auditMode}
            @change=${(e: Event) =>
              props.onAuditModeChange(
                (e.target as HTMLSelectElement).value as SecurityAuditModeKey,
              )}
          >
            <option value="both">Both</option>
            <option value="denied">Denied only</option>
            <option value="allowed">Allowed only</option>
          </select>
        </label>
        <label class="field" style="min-width: 180px;">
          <span>Method</span>
          <input
            .value=${props.filters.method}
            @input=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                method: (e.target as HTMLInputElement).value,
              })}
            placeholder="sessions.list"
          />
        </label>
        <label class="field" style="min-width: 180px;">
          <span>Reason</span>
          <input
            .value=${props.filters.reasonCode}
            @input=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                reasonCode: (e.target as HTMLInputElement).value,
              })}
            placeholder="OWNER_MISMATCH"
          />
        </label>
        <label class="field" style="min-width: 180px;">
          <span>Error code</span>
          <input
            .value=${props.filters.errorCode}
            @input=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                errorCode: (e.target as HTMLInputElement).value,
              })}
            placeholder="INVALID_REQUEST"
          />
        </label>
        <label class="field" style="min-width: 180px;">
          <span>User ID</span>
          <input
            .value=${props.filters.userId}
            @input=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                userId: (e.target as HTMLInputElement).value,
              })}
            placeholder="uuid"
          />
        </label>
        <label class="field" style="min-width: 220px;">
          <span>Principal ID</span>
          <input
            .value=${props.filters.principalId}
            @input=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                principalId: (e.target as HTMLInputElement).value,
              })}
            placeholder="msg:telegram:default:123"
          />
        </label>
        <label class="field" style="min-width: 160px;">
          <span>Actor role</span>
          <input
            .value=${props.filters.actorRole}
            @input=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                actorRole: (e.target as HTMLInputElement).value,
              })}
            placeholder="user"
          />
        </label>
        <label class="field" style="min-width: 160px;">
          <span>Source role</span>
          <input
            .value=${props.filters.sourceRole}
            @input=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                sourceRole: (e.target as HTMLInputElement).value,
              })}
            placeholder="operator"
          />
        </label>
        <label class="field" style="min-width: 180px;">
          <span>Client ID</span>
          <input
            .value=${props.filters.clientId}
            @input=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                clientId: (e.target as HTMLInputElement).value,
              })}
            placeholder="control-ui"
          />
        </label>
        <label class="field" style="min-width: 160px;">
          <span>Client mode</span>
          <input
            .value=${props.filters.clientMode}
            @input=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                clientMode: (e.target as HTMLInputElement).value,
              })}
            placeholder="webchat"
          />
        </label>
        <label class="field" style="min-width: 180px;">
          <span>Source IP</span>
          <input
            .value=${props.filters.sourceIp}
            @input=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                sourceIp: (e.target as HTMLInputElement).value,
              })}
            placeholder="203.0.113.7"
          />
        </label>
        <label class="field" style="min-width: 180px;">
          <span>Since (epoch ms)</span>
          <input
            .value=${props.filters.sinceTs}
            @input=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                sinceTs: (e.target as HTMLInputElement).value,
              })}
            placeholder="1739232000000"
          />
        </label>
        <label class="field" style="min-width: 180px;">
          <span>Until (epoch ms)</span>
          <input
            .value=${props.filters.untilTs}
            @input=${(e: Event) =>
              props.onFiltersChange({
                ...props.filters,
                untilTs: (e.target as HTMLInputElement).value,
              })}
            placeholder="1739318400000"
          />
        </label>
      </div>
      <div class="row" style="margin-top: 8px; gap: 8px; flex-wrap: wrap;">
        ${(
          [
            { key: "last-1h", label: "Last 1h" },
            { key: "last-24h", label: "Last 24h" },
            { key: "last-7d", label: "Last 7d" },
            { key: "all-time", label: "All time" },
          ] as Array<{ key: SecurityTimePresetKey; label: string }>
        ).map(
          (preset) => html`
            <button
              class="btn ${props.activeTimePreset === preset.key ? "primary" : ""}"
              ?disabled=${props.loading}
              @click=${() => props.onApplyTimePreset(preset.key)}
            >
              ${preset.label}
            </button>
          `,
        )}
      </div>
      <div class="row" style="margin-top: 8px; gap: 8px; flex-wrap: wrap;">
        ${(
          [
            { key: "owner-mismatch-24h", label: "Owner mismatch 24h" },
            { key: "scope-missing-24h", label: "Scope missing 24h" },
            { key: "role-forbidden-24h", label: "Role forbidden 24h" },
            { key: "policy-deny-24h", label: "Policy deny 24h" },
            { key: "unknown-sender-24h", label: "Unknown sender 24h" },
            { key: "plugin-role-forbidden-24h", label: "Plugin forbidden 24h" },
            { key: "plugin-unknown-sender-24h", label: "Plugin unauthorized 24h" },
            { key: "plugin-allow-24h", label: "Plugin allow 24h" },
            { key: "openai-role-forbidden-24h", label: "OpenAI forbidden 24h" },
            { key: "openai-unknown-sender-24h", label: "OpenAI unauthorized 24h" },
            { key: "openai-allow-24h", label: "OpenAI allow 24h" },
            { key: "openresponses-role-forbidden-24h", label: "Responses forbidden 24h" },
            { key: "openresponses-unknown-sender-24h", label: "Responses unauthorized 24h" },
            { key: "openresponses-allow-24h", label: "Responses allow 24h" },
            { key: "tools-role-forbidden-24h", label: "Tools forbidden 24h" },
            { key: "tools-unknown-sender-24h", label: "Tools unauthorized 24h" },
            { key: "tools-allow-24h", label: "Tools allow 24h" },
            { key: "hooks-role-forbidden-24h", label: "Hooks forbidden 24h" },
            { key: "hooks-unknown-sender-24h", label: "Hooks unauthorized 24h" },
            { key: "hooks-allow-24h", label: "Hooks allow 24h" },
            { key: "canvas-http-role-forbidden-24h", label: "Canvas HTTP forbidden 24h" },
            { key: "canvas-ws-role-forbidden-24h", label: "Canvas WS forbidden 24h" },
            { key: "canvas-http-unknown-sender-24h", label: "Canvas HTTP unauthorized 24h" },
            { key: "canvas-ws-unknown-sender-24h", label: "Canvas WS unauthorized 24h" },
            { key: "canvas-http-allow-24h", label: "Canvas HTTP allow 24h" },
            { key: "canvas-ws-allow-24h", label: "Canvas WS allow 24h" },
          ] as Array<{ key: SecurityPresetKey; label: string }>
        ).map(
          (preset) => html`
            <button
              class="btn ${props.activePreset === preset.key ? "primary" : ""}"
              ?disabled=${props.loading}
              @click=${() => props.onApplyPreset(preset.key)}
            >
              ${preset.label}
            </button>
          `,
        )}
      </div>
      <div class="row" style="margin-top: 8px; gap: 8px;">
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>Apply filters</button>
        <button class="btn" ?disabled=${props.loading || !hasFilters} @click=${props.onResetFilters}>
          Clear filters
        </button>
        <button
          class="btn"
          ?disabled=${props.loading || !hasMoreForMode}
          @click=${props.onLoadOlder}
        >
          Load older
        </button>
        ${
          props.auditMode === "both"
            ? html`
                <button
                  class="btn"
                  ?disabled=${props.loading || !props.hasMore}
                  @click=${props.onLoadOlderDenied}
                >
                  Load older denied
                </button>
                <button
                  class="btn"
                  ?disabled=${props.loading || !props.allowHasMore}
                  @click=${props.onLoadOlderAllow}
                >
                  Load older allow
                </button>
              `
            : nothing
        }
        <button
          class="btn"
          ?disabled=${!showDenied || props.deniedEvents.length === 0}
          @click=${() =>
            props.onExport(props.deniedEvents, hasFilters ? "security-filtered" : "security")}
        >
          Export denied CSV
        </button>
        <button
          class="btn"
          ?disabled=${!showDenied || !props.deniedSummary}
          @click=${() =>
            props.deniedSummary
              ? props.onExportDeniedSummary(
                  props.deniedSummary,
                  hasFilters ? "security-denied-summary-filtered" : "security-denied-summary",
                )
              : null}
        >
          Export denied summary CSV
        </button>
      </div>
      ${
        nextCursorEntries.length > 0
          ? html`
              <div class="row" style="margin-top: 6px; gap: 8px; flex-wrap: wrap;">
                ${nextCursorEntries.map(
                  (entry) =>
                    html`<div class="pill"><span>${entry.label}</span><span class="mono">${entry.cursor}</span></div>`,
                )}
              </div>
            `
          : nothing
      }
      <div class="row" style="margin-top: 6px; gap: 8px; flex-wrap: wrap;">
        <div class="pill">
          <span>${deniedFeedStatus}</span>
        </div>
        <div class="pill">
          <span>${allowFeedStatus}</span>
        </div>
      </div>
      ${
        showDenied
          ? html`
              ${
                props.deniedError
                  ? html`<div class="callout danger" style="margin-top: 12px;">${props.deniedError}</div>`
                  : nothing
              }
              ${
                props.deniedSummaryError
                  ? html`<div class="callout danger" style="margin-top: 12px;">${props.deniedSummaryError}</div>`
                  : nothing
              }
              <div class="row" style="margin-top: 12px; gap: 8px;">
                <div class="pill">
                  <span>Matched denies</span>
                  <span class="mono">${summaryTotal}</span>
                </div>
                ${topReasons.map(
                  ({ key, count }) => html`
                    <div class="pill warn">
                      <span>${key}</span>
                      <span class="mono">${count}</span>
                    </div>
                  `,
                )}
                ${
                  summaryEarliestTs != null && summaryLatestTs != null
                    ? html`
                        <div class="pill">
                          <span>Window</span>
                          <span class="mono"
                            >${formatDenyEventTs(summaryEarliestTs)} →
                            ${formatDenyEventTs(summaryLatestTs)}</span
                          >
                        </div>
                      `
                    : nothing
                }
              </div>
              ${
                topMethods.length > 0
                  ? html`
                      <div class="row" style="margin-top: 8px; gap: 8px;">
                        ${topMethods.map(
                          ({ key, count }) => html`
                            <div class="pill">
                              <span>${key}</span>
                              <span class="mono">${count}</span>
                            </div>
                          `,
                        )}
                      </div>
                    `
                  : nothing
              }
              ${
                topPrincipals.length > 0
                  ? html`
                      <div class="row" style="margin-top: 8px; gap: 8px;">
                        ${topPrincipals.map(
                          ({ key, count }) => html`
                            <div class="pill">
                              <span>principal=${key}</span>
                              <span class="mono">${count}</span>
                            </div>
                          `,
                        )}
                      </div>
                    `
                  : nothing
              }
              ${
                topSourceIps.length > 0
                  ? html`
                      <div class="row" style="margin-top: 8px; gap: 8px;">
                        ${topSourceIps.map(
                          ({ key, count }) => html`
                            <div class="pill">
                              <span>sourceIp=${key}</span>
                              <span class="mono">${count}</span>
                            </div>
                          `,
                        )}
                      </div>
                    `
                  : nothing
              }
              ${
                highFrequencyThreshold != null
                  ? highFrequencyPrincipals.length > 0
                    ? html`
                        <div class="callout warn" style="margin-top: 12px;">
                          High-frequency denied principals (threshold ≥ ${highFrequencyThreshold}):
                          ${highFrequencyPrincipals
                            .map((entry) => `${entry.key} (${entry.count})`)
                            .join(", ")}
                        </div>
                      `
                    : html`
                        <div class="muted" style="margin-top: 12px;">
                          No principals above deny threshold (${highFrequencyThreshold}).
                        </div>
                      `
                  : nothing
              }
              ${
                highFrequencyThreshold != null
                  ? highFrequencySourceIps.length > 0
                    ? html`
                        <div class="callout warn" style="margin-top: 8px;">
                          High-frequency denied source IPs (threshold ≥ ${highFrequencyThreshold}):
                          ${highFrequencySourceIps
                            .map((entry) => `${entry.key} (${entry.count})`)
                            .join(", ")}
                        </div>
                      `
                    : html`
                        <div class="muted" style="margin-top: 8px;">
                          No source IPs above deny threshold (${highFrequencyThreshold}).
                        </div>
                      `
                  : nothing
              }
              ${
                props.deniedEvents.length === 0
                  ? html`
                      <div class="muted" style="margin-top: 12px">No deny events yet.</div>
                    `
                  : html`
                      <div class="list" style="margin-top: 12px;">
                        ${props.deniedEvents.map(
                          (event) => html`
                            <div class="list-item">
                              <div class="list-main">
                                <div class="list-title">${event.reasonCode} · ${event.method}</div>
                                <div class="list-sub">
                                  ${formatDenyEventTs(event.ts)} · req=${event.requestId}
                                </div>
                              </div>
                              <div class="list-meta">
                                <div class="muted">
                                  actor=${event.userAlias ?? event.principalId ?? event.userId ?? "unknown"} · role=${event.actorRole ?? "unknown"}
                                </div>
                                <div class="muted">
                                  client=${event.clientId ?? "unknown"} · mode=${event.clientMode ?? "unknown"} · ip=${event.sourceIp ?? "unknown"}
                                </div>
                                <div>${event.errorMessage}</div>
                              </div>
                            </div>
                          `,
                        )}
                      </div>
                    `
              }
            `
          : html`
              <div class="muted" style="margin-top: 12px">
                Denied feed hidden while "Allowed only" mode is active.
              </div>
            `
      }
    </section>
    ${
      showAllowed
        ? html`
            <section class="card" style="margin-top: 12px;">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Allowed Access Events</div>
          <div class="card-sub">Recent authorization allows from authz.allow.list.</div>
        </div>
        <div class="row" style="gap: 8px;">
          <button
            class="btn"
            ?disabled=${props.allowEvents.length === 0}
            @click=${() =>
              props.onExportAllow(
                props.allowEvents,
                hasFilters ? "security-allow-filtered" : "security-allow",
              )}
          >
            Export allow CSV
          </button>
          <button
            class="btn"
            ?disabled=${!props.allowSummary}
            @click=${() =>
              props.allowSummary
                ? props.onExportAllowSummary(
                    props.allowSummary,
                    hasFilters ? "security-allow-summary-filtered" : "security-allow-summary",
                  )
                : null}
          >
            Export allow summary CSV
          </button>
        </div>
      </div>
      ${
        props.allowError
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.allowError}</div>`
          : nothing
      }
      ${
        props.allowSummaryError
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.allowSummaryError}</div>`
          : nothing
      }
      <div class="row" style="margin-top: 12px; gap: 8px;">
        <div class="pill">
          <span>Matched allows</span>
          <span class="mono">${allowSummaryTotal}</span>
        </div>
        ${
          allowSummaryEarliestTs != null && allowSummaryLatestTs != null
            ? html`
                <div class="pill">
                  <span>Window</span>
                  <span class="mono"
                    >${formatDenyEventTs(allowSummaryEarliestTs)} →
                    ${formatDenyEventTs(allowSummaryLatestTs)}</span
                  >
                </div>
              `
            : nothing
        }
      </div>
      ${
        allowTopMethods.length > 0
          ? html`
              <div class="row" style="margin-top: 8px; gap: 8px;">
                ${allowTopMethods.map(
                  ({ key, count }) => html`
                    <div class="pill">
                      <span>${key}</span>
                      <span class="mono">${count}</span>
                    </div>
                  `,
                )}
              </div>
            `
          : nothing
      }
      ${
        allowTopPrincipals.length > 0
          ? html`
              <div class="row" style="margin-top: 8px; gap: 8px;">
                ${allowTopPrincipals.map(
                  ({ key, count }) => html`
                    <div class="pill">
                      <span>principal=${key}</span>
                      <span class="mono">${count}</span>
                    </div>
                  `,
                )}
              </div>
            `
          : nothing
      }
      ${
        allowTopSourceIps.length > 0
          ? html`
              <div class="row" style="margin-top: 8px; gap: 8px;">
                ${allowTopSourceIps.map(
                  ({ key, count }) => html`
                    <div class="pill">
                      <span>sourceIp=${key}</span>
                      <span class="mono">${count}</span>
                    </div>
                  `,
                )}
              </div>
            `
          : nothing
      }
      ${
        allowHighFrequencyThreshold != null
          ? allowHighFrequencyPrincipals.length > 0
            ? html`
                <div class="callout" style="margin-top: 12px;">
                  High-frequency allowed principals (threshold ≥ ${allowHighFrequencyThreshold}):
                  ${allowHighFrequencyPrincipals
                    .map((entry) => `${entry.key} (${entry.count})`)
                    .join(", ")}
                </div>
              `
            : html`
                <div class="muted" style="margin-top: 12px;">
                  No principals above allow threshold (${allowHighFrequencyThreshold}).
                </div>
              `
          : nothing
      }
      ${
        allowHighFrequencyThreshold != null
          ? allowHighFrequencySourceIps.length > 0
            ? html`
                <div class="callout" style="margin-top: 8px;">
                  High-frequency allowed source IPs (threshold ≥ ${allowHighFrequencyThreshold}):
                  ${allowHighFrequencySourceIps
                    .map((entry) => `${entry.key} (${entry.count})`)
                    .join(", ")}
                </div>
              `
            : html`
                <div class="muted" style="margin-top: 8px;">
                  No source IPs above allow threshold (${allowHighFrequencyThreshold}).
                </div>
              `
          : nothing
      }
      ${
        props.allowEvents.length === 0
          ? html`
              <div class="muted" style="margin-top: 12px">No allow events yet.</div>
            `
          : html`
              <div class="list" style="margin-top: 12px;">
                ${props.allowEvents.map(
                  (event) => html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${event.method}</div>
                        <div class="list-sub">
                          ${formatDenyEventTs(event.ts)} · req=${event.requestId}
                        </div>
                      </div>
                      <div class="list-meta">
                        <div class="muted">
                          actor=${event.userAlias ?? event.principalId ?? event.userId ?? "unknown"} · role=${event.actorRole ?? "unknown"}
                        </div>
                        <div class="muted">
                          client=${event.clientId ?? "unknown"} · mode=${event.clientMode ?? "unknown"} · ip=${event.sourceIp ?? "unknown"}
                        </div>
                      </div>
                    </div>
                  `,
                )}
              </div>
            `
      }
    </section>
          `
        : nothing
    }
    <section class="card" style="margin-top: 12px;">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Configuration Change History</div>
          <div class="card-sub">Recent successful config writes from config.changes.list.</div>
        </div>
        <button
          class="btn"
          ?disabled=${props.configChanges.length === 0}
          @click=${() => props.onExportConfigChanges(props.configChanges, "config-changes")}
        >
          Export CSV
        </button>
      </div>
      ${
        props.configChangesError
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.configChangesError}</div>`
          : nothing
      }
      ${
        props.configChanges.length === 0
          ? html`
              <div class="muted" style="margin-top: 12px">No config change events yet.</div>
            `
          : html`
              <div class="list" style="margin-top: 12px;">
                ${props.configChanges.map(
                  (event) => html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${event.method} · ${event.path}</div>
                        <div class="list-sub">
                          ${formatDenyEventTs(event.ts)} · req=${event.requestId}
                        </div>
                      </div>
                      <div class="list-meta">
                        <div class="muted">
                          actor=${event.userAlias ?? event.principalId ?? event.userId ?? "unknown"} · role=${event.actorRole ?? "unknown"}
                        </div>
                        <div class="muted">
                          client=${event.clientId ?? "unknown"} · mode=${event.clientMode ?? "unknown"} · ip=${event.sourceIp ?? "unknown"}
                        </div>
                        ${
                          event.sessionKey
                            ? html`<div class="muted">sessionKey=${event.sessionKey}</div>`
                            : nothing
                        }
                        ${event.note ? html`<div class="muted">note=${event.note}</div>` : nothing}
                      </div>
                    </div>
                  `,
                )}
              </div>
            `
      }
    </section>
    <section class="card" style="margin-top: 12px;">
      <div class="card-title">Configuration Validation Warnings</div>
      <div class="card-sub">
        Current non-blocking config warnings from config.get (for example, missing identity roles).
      </div>
      ${
        props.configWarningsError
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.configWarningsError}</div>`
          : nothing
      }
      ${
        props.configWarnings.length === 0
          ? html`
              <div class="muted" style="margin-top: 12px">No configuration warnings.</div>
            `
          : html`
              <div class="list" style="margin-top: 12px;">
                ${props.configWarnings.map(
                  (warning) => html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${warning.path}</div>
                      </div>
                      <div class="list-meta">${warning.message}</div>
                    </div>
                  `,
                )}
              </div>
            `
      }
    </section>
    <section class="card" style="margin-top: 12px;">
      <div class="card-title">Identity Mapping Role Gaps</div>
      <div class="card-sub">
        Identity mappings that are missing explicit role assignment in multi-user enforcement mode.
      </div>
      ${
        props.identityRoleWarnings.length === 0
          ? html`
              <div class="muted" style="margin-top: 12px">No unresolved identity-role mappings.</div>
            `
          : html`
              <div class="list" style="margin-top: 12px;">
                ${props.identityRoleWarnings.map(
                  (warning) => html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${warning.principalId}</div>
                        <div class="list-sub">${warning.path}</div>
                      </div>
                      <div class="list-meta">${warning.message}</div>
                    </div>
                  `,
                )}
              </div>
            `
      }
    </section>
    ${
      props.canManageBackfill
        ? html`
            <section class="card" style="margin-top: 12px;">
              <div class="card-title">Policy Bundles</div>
              <div class="card-sub">
                Baseline presets for gateway multi-user posture (admin only).
              </div>
              <div class="row" style="margin-top: 12px; gap: 8px; align-items: flex-end;">
                <label class="field" style="min-width: 320px;">
                  <span>Bundle</span>
                  <select
                    .value=${props.policyBundleSelectedId}
                    ?disabled=${props.policyBundlesLoading || props.policyBundleResolveLoading}
                    @change=${(e: Event) => {
                      const next = (e.target as HTMLSelectElement).value as
                        | ConfigPolicyBundleId
                        | "";
                      props.onPolicyBundleSelect(next);
                    }}
                  >
                    <option value="" ?selected=${props.policyBundleSelectedId === ""}>
                      Select a bundle
                    </option>
                    ${props.policyBundles.map(
                      (bundle) =>
                        html`<option value=${bundle.id} ?selected=${props.policyBundleSelectedId === bundle.id}>
                          ${bundle.title}
                        </option>`,
                    )}
                  </select>
                </label>
                <button
                  class="btn"
                  ?disabled=${props.policyBundlesLoading || props.loading}
                  @click=${props.onPolicyBundlesRefresh}
                >
                  ${props.policyBundlesLoading ? "Refreshing…" : "Refresh bundles"}
                </button>
                <button
                  class="btn primary"
                  ?disabled=${
                    props.policyBundleSelectedId === "" ||
                    props.policyBundleApplyBusy ||
                    props.policyBundleResolveLoading ||
                    props.loading
                  }
                  @click=${() => {
                    if (props.policyBundleSelectedId) {
                      props.onPolicyBundleApply(props.policyBundleSelectedId);
                    }
                  }}
                >
                  ${props.policyBundleApplyBusy ? "Applying…" : "Apply bundle"}
                </button>
              </div>
              ${
                props.policyBundleResolved
                  ? html`
                      <div class="row" style="margin-top: 8px;">
                        <div class="pill">
                          <span>ID</span>
                          <span class="mono">${props.policyBundleResolved.id}</span>
                        </div>
                      </div>
                      <div class="muted" style="margin-top: 8px;">
                        ${props.policyBundleResolved.description}
                      </div>
                      <pre style="margin-top: 12px;"><code>${policyBundlePatch}</code></pre>
                    `
                  : html`
                      <div class="muted" style="margin-top: 12px">
                        Select a policy bundle to preview its patch payload.
                      </div>
                    `
              }
              ${
                props.policyBundlesError
                  ? html`<div class="callout danger" style="margin-top: 12px;">${props.policyBundlesError}</div>`
                  : nothing
              }
              ${
                props.policyBundleResolveError
                  ? html`<div class="callout danger" style="margin-top: 12px;">${props.policyBundleResolveError}</div>`
                  : nothing
              }
              ${
                props.policyBundleApplyError
                  ? html`<div class="callout danger" style="margin-top: 12px;">${props.policyBundleApplyError}</div>`
                  : nothing
              }
              ${
                props.policyBundleApplyMessage
                  ? html`<div class="callout success" style="margin-top: 12px;">${props.policyBundleApplyMessage}</div>`
                  : nothing
              }
            </section>
          `
        : nothing
    }
    <section class="card" style="margin-top: 12px;">
      <div class="card-title">Ownership Gaps</div>
      <div class="card-sub">Missing owner metadata from ownership.gaps.</div>
      ${
        props.ownershipGapsError
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.ownershipGapsError}</div>`
          : nothing
      }
      ${
        props.ownershipGaps
          ? html`
              <div class="row" style="margin-top: 12px; gap: 8px;">
                <div class="pill">
                  <span>Missing</span>
                  <span class="mono">${ownershipSummary?.missing ?? 0}</span>
                </div>
                <div class="pill">
                  <span>Scanned</span>
                  <span class="mono">${ownershipSummary?.scanned ?? 0}</span>
                </div>
                <div class="pill">
                  <span>Sample limit</span>
                  <span class="mono">${props.ownershipGaps.limit}</span>
                </div>
              </div>
              <div class="row" style="margin-top: 8px; gap: 8px;">
                <button
                  class="btn"
                  ?disabled=${props.loading}
                  @click=${() =>
                    props.ownershipGaps &&
                    props.onExportOwnershipGaps(props.ownershipGaps, "ownership-gaps")}
                >
                  Export Gaps CSV
                </button>
              </div>
              <div class="list" style="margin-top: 12px;">
                ${
                  ownershipResources?.agents
                    ? html`
                        <div class="list-item">
                          <div class="list-main">
                            <div class="list-title">agents</div>
                            <div class="list-sub">
                              scanned=${ownershipResources.agents.scanned} missing=${ownershipResources.agents.missing}
                            </div>
                          </div>
                          <div class="list-meta">
                            ${ownershipResources.agents.missingAgentIds.join(", ") || "no samples"}
                          </div>
                        </div>
                      `
                    : nothing
                }
                ${
                  ownershipResources?.browserProfiles
                    ? html`
                        <div class="list-item">
                          <div class="list-main">
                            <div class="list-title">browserProfiles</div>
                            <div class="list-sub">
                              scanned=${ownershipResources.browserProfiles.scanned} missing=${ownershipResources.browserProfiles.missing}
                            </div>
                          </div>
                          <div class="list-meta">
                            ${
                              ownershipResources.browserProfiles.missingProfiles.join(", ") ||
                              "no samples"
                            }
                          </div>
                        </div>
                      `
                    : nothing
                }
                ${
                  ownershipResources?.nodes
                    ? html`
                        <div class="list-item">
                          <div class="list-main">
                            <div class="list-title">nodes</div>
                            <div class="list-sub">
                              scanned=${ownershipResources.nodes.scanned} missing=${ownershipResources.nodes.missing}
                            </div>
                          </div>
                          <div class="list-meta">
                            ${ownershipResources.nodes.missingNodeIds.join(", ") || "no samples"}
                          </div>
                        </div>
                      `
                    : nothing
                }
                ${
                  ownershipResources?.sessions
                    ? html`
                        <div class="list-item">
                          <div class="list-main">
                            <div class="list-title">sessions</div>
                            <div class="list-sub">
                              scanned=${ownershipResources.sessions.scanned} missing=${ownershipResources.sessions.missing}
                            </div>
                            <div class="list-sub">
                              storesScanned=${ownershipResources.sessions.storesScanned} storesWithMissing=${ownershipResources.sessions.storesWithMissing}
                            </div>
                          </div>
                          <div class="list-meta">
                            ${
                              ownershipResources.sessions.missingSamples
                                .map((sample) => `${sample.storePath}#${sample.key}`)
                                .join(", ") || "no samples"
                            }
                          </div>
                        </div>
                      `
                    : nothing
                }
                ${
                  ownershipResources?.memory
                    ? html`
                        <div class="list-item">
                          <div class="list-main">
                            <div class="list-title">memory</div>
                            <div class="list-sub">
                              scanned=${ownershipResources.memory.scanned} missing=${ownershipResources.memory.missing}
                            </div>
                          </div>
                          <div class="list-meta">
                            ${ownershipResources.memory.missingPaths.join(", ") || "no samples"}
                          </div>
                        </div>
                      `
                    : nothing
                }
              </div>
            `
          : html`
              <div class="muted" style="margin-top: 12px">No ownership gap data yet.</div>
            `
      }
    </section>
    ${
      props.canManageBackfill
        ? html`
            <section class="card" style="margin-top: 12px;">
              <div class="card-title">Ownership Backfill</div>
              <div class="card-sub">Backfill missing owner metadata (admin only).</div>
              <div class="filters" style="margin-top: 12px;">
                <label class="field" style="min-width: 280px;">
                  <span>Owner user ID</span>
                  <input
                    .value=${props.backfill.ownerUserId}
                    @input=${(e: Event) =>
                      props.onBackfillChange({
                        ...props.backfill,
                        ownerUserId: (e.target as HTMLInputElement).value,
                      })}
                    placeholder="uuid"
                  />
                </label>
                <label class="field" style="min-width: 320px;">
                  <span>Owner principal ID (optional)</span>
                  <input
                    .value=${props.backfill.ownerPrincipalId}
                    @input=${(e: Event) =>
                      props.onBackfillChange({
                        ...props.backfill,
                        ownerPrincipalId: (e.target as HTMLInputElement).value,
                      })}
                    placeholder="msg:telegram:default:123"
                  />
                </label>
                <label class="field" style="min-width: 360px;">
                  <span>Resources (comma separated, optional)</span>
                  <input
                    .value=${props.backfill.resources}
                    @input=${(e: Event) =>
                      props.onBackfillChange({
                        ...props.backfill,
                        resources: (e.target as HTMLInputElement).value,
                      })}
                    placeholder="agents,sessions,nodes,browserProfiles,memory"
                  />
                </label>
                <label class="field" style="min-width: 240px;">
                  <span>Type APPLY (full apply only)</span>
                  <input
                    .value=${props.backfill.confirmText}
                    @input=${(e: Event) =>
                      props.onBackfillChange({
                        ...props.backfill,
                        confirmText: (e.target as HTMLInputElement).value,
                      })}
                    placeholder="APPLY"
                  />
                </label>
              </div>
              <div class="row" style="margin-top: 8px; gap: 8px;">
                <button
                  class="btn"
                  ?disabled=${props.loading || props.backfillBusy}
                  @click=${() =>
                    props.onBackfillChange({
                      ...props.backfill,
                      resources: "sessions",
                    })}
                >
                  Sessions Only
                </button>
                <button
                  class="btn"
                  ?disabled=${props.loading || props.backfillBusy || !hasBackfillOwnerUserId}
                  @click=${() => props.onRunBackfill({ dryRun: true, resources: "sessions" })}
                >
                  Preview Sessions
                </button>
                <button
                  class="btn primary"
                  ?disabled=${props.loading || props.backfillBusy || !hasBackfillOwnerUserId}
                  @click=${() => props.onRunBackfill({ dryRun: false, resources: "sessions" })}
                >
                  Apply Sessions
                </button>
                <button
                  class="btn"
                  ?disabled=${props.loading || props.backfillBusy || !hasBackfillOwnerUserId}
                  @click=${() => props.onRunBackfill({ dryRun: true, resources: "agents" })}
                >
                  Preview Agents
                </button>
                <button
                  class="btn primary"
                  ?disabled=${props.loading || props.backfillBusy || !hasBackfillOwnerUserId}
                  @click=${() => props.onRunBackfill({ dryRun: false, resources: "agents" })}
                >
                  Apply Agents
                </button>
                <button
                  class="btn"
                  ?disabled=${props.loading || props.backfillBusy || !hasBackfillOwnerUserId}
                  @click=${() => props.onRunBackfill({ dryRun: true, resources: "nodes" })}
                >
                  Preview Nodes
                </button>
                <button
                  class="btn primary"
                  ?disabled=${props.loading || props.backfillBusy || !hasBackfillOwnerUserId}
                  @click=${() => props.onRunBackfill({ dryRun: false, resources: "nodes" })}
                >
                  Apply Nodes
                </button>
                <button
                  class="btn"
                  ?disabled=${props.loading || props.backfillBusy || !hasBackfillOwnerUserId}
                  @click=${() => props.onRunBackfill({ dryRun: true, resources: "browserProfiles" })}
                >
                  Preview Profiles
                </button>
                <button
                  class="btn primary"
                  ?disabled=${props.loading || props.backfillBusy || !hasBackfillOwnerUserId}
                  @click=${() => props.onRunBackfill({ dryRun: false, resources: "browserProfiles" })}
                >
                  Apply Profiles
                </button>
                <button
                  class="btn"
                  ?disabled=${props.loading || props.backfillBusy || !hasBackfillOwnerUserId}
                  @click=${() => props.onRunBackfill({ dryRun: true, resources: "memory" })}
                >
                  Preview Memory
                </button>
                <button
                  class="btn primary"
                  ?disabled=${props.loading || props.backfillBusy || !hasBackfillOwnerUserId}
                  @click=${() => props.onRunBackfill({ dryRun: false, resources: "memory" })}
                >
                  Apply Memory
                </button>
              </div>
              <div class="row" style="margin-top: 8px; gap: 8px;">
                <button
                  class="btn"
                  ?disabled=${props.loading || props.backfillBusy}
                  @click=${() =>
                    props.onBackfillChange({
                      ...props.backfill,
                      resources: "",
                    })}
                >
                  Use All Resources
                </button>
                <button
                  class="btn"
                  ?disabled=${props.loading || props.backfillBusy || !hasBackfillOwnerUserId}
                  @click=${() => props.onRunBackfill({ dryRun: true })}
                >
                  ${props.backfillBusy ? "Running…" : "Preview Backfill"}
                </button>
                <button
                  class="btn primary"
                  ?disabled=${
                    props.loading ||
                    props.backfillBusy ||
                    !hasBackfillOwnerUserId ||
                    (requiresApplyPhrase && !hasApplyPhrase)
                  }
                  @click=${() => props.onRunBackfill({ dryRun: false })}
                >
                  ${props.backfillBusy ? "Running…" : "Apply Backfill"}
                </button>
              </div>
              ${
                requiresApplyPhrase && !hasApplyPhrase
                  ? html`
                      <div class="muted" style="margin-top: 8px">
                        Type <span class="mono">APPLY</span> to enable full apply across all resources.
                      </div>
                    `
                  : nothing
              }
              ${
                props.backfillError
                  ? html`<div class="callout danger" style="margin-top: 12px;">${props.backfillError}</div>`
                  : nothing
              }
              ${
                props.backfillResult
                  ? html`
                      <div class="row" style="margin-top: 12px; gap: 8px;">
                        <div class="pill">
                          <span>Mode</span>
                          <span class="mono">${props.backfillResult.dryRun ? "dry-run" : "apply"}</span>
                        </div>
                        <div class="pill">
                          <span>Scanned</span>
                          <span class="mono">${props.backfillResult.summary.scanned}</span>
                        </div>
                        <div class="pill">
                          <span>Updated</span>
                          <span class="mono">${props.backfillResult.summary.updated}</span>
                        </div>
                        <div class="pill">
                          <span>Skipped</span>
                          <span class="mono">${props.backfillResult.summary.skipped}</span>
                        </div>
                      </div>
                      <div class="list" style="margin-top: 12px;">
                        ${Object.entries(props.backfillResult.resources)
                          .filter(([, stats]) => Boolean(stats))
                          .map(([resource, stats]) => {
                            const typedStats = stats as {
                              scanned: number;
                              updated: number;
                              skipped: number;
                            };
                            return html`
                              <div class="list-item">
                                <div class="list-main">
                                  <div class="list-title">${resource}</div>
                                  <div class="list-sub">
                                    scanned=${typedStats.scanned} updated=${typedStats.updated}
                                    skipped=${typedStats.skipped}
                                  </div>
                                </div>
                              </div>
                            `;
                          })}
                      </div>
                    `
                  : nothing
              }
            </section>
          `
        : html`
            <section class="card" style="margin-top: 12px;">
              <div class="card-title">Ownership Backfill</div>
              <div class="card-sub">Requires admin principal role.</div>
              <div class="muted" style="margin-top: 12px;">
                Backfill controls are hidden for non-admin connections.
              </div>
              <div class="muted" style="margin-top: 8px;">
                principalRole=${authPrincipalRoleLabel} · role=${authRoleLabel} · scopes=${authScopesLabel}
              </div>
            </section>
          `
    }
  `;
}
