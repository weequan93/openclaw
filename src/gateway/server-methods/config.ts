import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { listChannelPlugins } from "../../channels/plugins/index.js";
import {
  CONFIG_PATH,
  loadConfig,
  parseConfigJson5,
  readConfigFileSnapshot,
  resolveConfigSnapshotHash,
  validateConfigObjectWithPlugins,
  writeConfigFile,
} from "../../config/config.js";
import { applyLegacyMigrations } from "../../config/legacy.js";
import { applyMergePatch } from "../../config/merge-patch.js";
import {
  redactConfigObject,
  redactConfigSnapshot,
  restoreRedactedValues,
} from "../../config/redact-snapshot.js";
import { buildConfigSchema } from "../../config/schema.js";
import {
  formatDoctorNonInteractiveHint,
  type RestartSentinelPayload,
  writeRestartSentinel,
} from "../../infra/restart-sentinel.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { loadOpenClawPlugins } from "../../plugins/loader.js";
import { resolveGatewayAuditSourceIp } from "../audit-source-ip.js";
import {
  listGatewayConfigChangeEventsPage,
  recordGatewayConfigChangeEvent,
} from "../config-change-events.js";
import {
  applyGatewayPolicyBundle,
  listGatewayPolicyBundles,
  resolveGatewayPolicyBundle,
} from "../config-policy-bundles.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateConfigApplyParams,
  validateConfigChangesListParams,
  validateConfigGetParams,
  validateConfigPolicyBundleApplyParams,
  validateConfigPolicyBundleResolveParams,
  validateConfigPolicyBundlesListParams,
  validateConfigPatchParams,
  validateConfigSchemaParams,
  validateConfigSetParams,
} from "../protocol/index.js";

function resolveBaseHash(params: unknown): string | null {
  const raw = (params as { baseHash?: unknown })?.baseHash;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function requireConfigBaseHash(
  params: unknown,
  snapshot: Awaited<ReturnType<typeof readConfigFileSnapshot>>,
  respond: RespondFn,
): boolean {
  if (!snapshot.exists) {
    return true;
  }
  const snapshotHash = resolveConfigSnapshotHash(snapshot);
  if (!snapshotHash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config base hash unavailable; re-run config.get and retry",
      ),
    );
    return false;
  }
  const baseHash = resolveBaseHash(params);
  if (!baseHash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config base hash required; re-run config.get and retry",
      ),
    );
    return false;
  }
  if (baseHash !== snapshotHash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config changed since last load; re-run config.get and retry",
      ),
    );
    return false;
  }
  return true;
}

export const configHandlers: GatewayRequestHandlers = {
  "config.policyBundles.list": async ({ params, respond }) => {
    if (!validateConfigPolicyBundlesListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.policyBundles.list params: ${formatValidationErrors(validateConfigPolicyBundlesListParams.errors)}`,
        ),
      );
      return;
    }
    respond(
      true,
      {
        ts: Date.now(),
        bundles: listGatewayPolicyBundles(),
      },
      undefined,
    );
  },
  "config.policyBundle.resolve": async ({ params, respond }) => {
    if (!validateConfigPolicyBundleResolveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.policyBundle.resolve params: ${formatValidationErrors(validateConfigPolicyBundleResolveParams.errors)}`,
        ),
      );
      return;
    }
    const bundleId = (
      params as {
        bundleId: "single_user" | "multi_user_isolated" | "strict_admin_control";
      }
    ).bundleId;
    const bundle = resolveGatewayPolicyBundle(bundleId);
    if (!bundle) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown policy bundle: ${bundleId}`),
      );
      return;
    }
    respond(
      true,
      {
        ts: Date.now(),
        bundle,
      },
      undefined,
    );
  },
  "config.policyBundle.apply": async ({ params, respond, req, owner, client }) => {
    if (!validateConfigPolicyBundleApplyParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.policyBundle.apply params: ${formatValidationErrors(validateConfigPolicyBundleApplyParams.errors)}`,
        ),
      );
      return;
    }
    const snapshot = await readConfigFileSnapshot();
    if (!requireConfigBaseHash(params, snapshot, respond)) {
      return;
    }
    if (!snapshot.valid) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config; fix before applying policy bundle"),
      );
      return;
    }
    const bundleId = (
      params as {
        bundleId: "single_user" | "multi_user_isolated" | "strict_admin_control";
      }
    ).bundleId;
    const bundle = resolveGatewayPolicyBundle(bundleId);
    if (!bundle) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown policy bundle: ${bundleId}`),
      );
      return;
    }
    const patched = applyGatewayPolicyBundle({
      config: snapshot.config,
      bundleId,
    });
    const migrated = applyLegacyMigrations(patched);
    const resolved = migrated.next ?? patched;
    const validated = validateConfigObjectWithPlugins(resolved);
    if (!validated.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
          details: { issues: validated.issues },
        }),
      );
      return;
    }
    await writeConfigFile(validated.config);

    const sessionKey =
      typeof (params as { sessionKey?: unknown }).sessionKey === "string"
        ? (params as { sessionKey?: string }).sessionKey?.trim() || undefined
        : undefined;
    const noteRaw =
      typeof (params as { note?: unknown }).note === "string"
        ? (params as { note?: string }).note?.trim() || undefined
        : undefined;
    const note = noteRaw ?? `policy-bundle:${bundleId}`;
    const restartDelayMsRaw = (params as { restartDelayMs?: unknown }).restartDelayMs;
    const restartDelayMs =
      typeof restartDelayMsRaw === "number" && Number.isFinite(restartDelayMsRaw)
        ? Math.max(0, Math.floor(restartDelayMsRaw))
        : undefined;

    const payload: RestartSentinelPayload = {
      kind: "config-apply",
      status: "ok",
      ts: Date.now(),
      sessionKey,
      message: note,
      doctorHint: formatDoctorNonInteractiveHint(),
      stats: {
        mode: "config.policyBundle.apply",
        root: CONFIG_PATH,
      },
    };
    let sentinelPath: string | null = null;
    try {
      sentinelPath = await writeRestartSentinel(payload);
    } catch {
      sentinelPath = null;
    }
    const restart = scheduleGatewaySigusr1Restart({
      delayMs: restartDelayMs,
      reason: "config.policyBundle.apply",
    });
    recordGatewayConfigChangeEvent({
      ts: Date.now(),
      requestId: req.id,
      method: "config.policyBundle.apply",
      path: CONFIG_PATH,
      userId: owner?.userId ?? null,
      userAlias: owner?.alias ?? null,
      principalId: owner?.principalId ?? null,
      actorRole: owner?.role ?? null,
      sourceRole: owner?.sourceRole ?? null,
      clientId:
        client && typeof client.connect?.client?.id === "string" ? client.connect.client.id : null,
      clientMode:
        client && typeof client.connect?.client?.mode === "string"
          ? client.connect.client.mode
          : null,
      sourceIp: resolveGatewayAuditSourceIp(client ?? {}),
      sessionKey: sessionKey ?? null,
      note,
      restartDelayMs: restartDelayMs ?? null,
    });
    respond(
      true,
      {
        ok: true,
        bundleId,
        path: CONFIG_PATH,
        config: redactConfigObject(validated.config),
        restart,
        sentinel: {
          path: sentinelPath,
          payload,
        },
      },
      undefined,
    );
  },
  "config.changes.list": async ({ params, respond }) => {
    if (!validateConfigChangesListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.changes.list params: ${formatValidationErrors(validateConfigChangesListParams.errors)}`,
        ),
      );
      return;
    }
    const raw = params as {
      limit?: number;
      cursor?: string;
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
    const page = listGatewayConfigChangeEventsPage({
      limit: raw.limit,
      cursor: typeof raw.cursor === "string" ? raw.cursor.trim() || undefined : undefined,
      order: raw.order,
      method: typeof raw.method === "string" ? raw.method.trim() || undefined : undefined,
      userId: typeof raw.userId === "string" ? raw.userId.trim() || undefined : undefined,
      principalId:
        typeof raw.principalId === "string" ? raw.principalId.trim() || undefined : undefined,
      actorRole: typeof raw.actorRole === "string" ? raw.actorRole.trim() || undefined : undefined,
      sourceRole:
        typeof raw.sourceRole === "string" ? raw.sourceRole.trim() || undefined : undefined,
      clientId: typeof raw.clientId === "string" ? raw.clientId.trim() || undefined : undefined,
      clientMode:
        typeof raw.clientMode === "string" ? raw.clientMode.trim() || undefined : undefined,
      sourceIp: typeof raw.sourceIp === "string" ? raw.sourceIp.trim() || undefined : undefined,
      sinceTs: raw.sinceTs,
      untilTs: raw.untilTs,
    });
    respond(
      true,
      {
        ts: Date.now(),
        events: page.events,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      },
      undefined,
    );
  },
  "config.get": async ({ params, respond }) => {
    if (!validateConfigGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.get params: ${formatValidationErrors(validateConfigGetParams.errors)}`,
        ),
      );
      return;
    }
    const snapshot = await readConfigFileSnapshot();
    respond(true, redactConfigSnapshot(snapshot), undefined);
  },
  "config.schema": ({ params, respond }) => {
    if (!validateConfigSchemaParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.schema params: ${formatValidationErrors(validateConfigSchemaParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const pluginRegistry = loadOpenClawPlugins({
      config: cfg,
      workspaceDir,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
    });
    const schema = buildConfigSchema({
      plugins: pluginRegistry.plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        configUiHints: plugin.configUiHints,
        configSchema: plugin.configJsonSchema,
      })),
      channels: listChannelPlugins().map((entry) => ({
        id: entry.id,
        label: entry.meta.label,
        description: entry.meta.blurb,
        configSchema: entry.configSchema?.schema,
        configUiHints: entry.configSchema?.uiHints,
      })),
    });
    respond(true, schema, undefined);
  },
  "config.set": async ({ params, respond, req, owner, client }) => {
    if (!validateConfigSetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.set params: ${formatValidationErrors(validateConfigSetParams.errors)}`,
        ),
      );
      return;
    }
    const snapshot = await readConfigFileSnapshot();
    if (!requireConfigBaseHash(params, snapshot, respond)) {
      return;
    }
    const rawValue = (params as { raw?: unknown }).raw;
    if (typeof rawValue !== "string") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config.set params: raw (string) required"),
      );
      return;
    }
    const parsedRes = parseConfigJson5(rawValue);
    if (!parsedRes.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsedRes.error));
      return;
    }
    const validated = validateConfigObjectWithPlugins(parsedRes.parsed);
    if (!validated.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
          details: { issues: validated.issues },
        }),
      );
      return;
    }
    let restored: typeof validated.config;
    try {
      restored = restoreRedactedValues(
        validated.config,
        snapshot.config,
      ) as typeof validated.config;
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, String(err instanceof Error ? err.message : err)),
      );
      return;
    }
    await writeConfigFile(restored);
    recordGatewayConfigChangeEvent({
      ts: Date.now(),
      requestId: req.id,
      method: "config.set",
      path: CONFIG_PATH,
      userId: owner?.userId ?? null,
      userAlias: owner?.alias ?? null,
      principalId: owner?.principalId ?? null,
      actorRole: owner?.role ?? null,
      sourceRole: owner?.sourceRole ?? null,
      clientId:
        client && typeof client.connect?.client?.id === "string" ? client.connect.client.id : null,
      clientMode:
        client && typeof client.connect?.client?.mode === "string"
          ? client.connect.client.mode
          : null,
      sourceIp: resolveGatewayAuditSourceIp(client ?? {}),
      sessionKey: null,
      note: null,
      restartDelayMs: null,
    });
    respond(
      true,
      {
        ok: true,
        path: CONFIG_PATH,
        config: redactConfigObject(restored),
      },
      undefined,
    );
  },
  "config.patch": async ({ params, respond, req, owner, client }) => {
    if (!validateConfigPatchParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.patch params: ${formatValidationErrors(validateConfigPatchParams.errors)}`,
        ),
      );
      return;
    }
    const snapshot = await readConfigFileSnapshot();
    if (!requireConfigBaseHash(params, snapshot, respond)) {
      return;
    }
    if (!snapshot.valid) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config; fix before patching"),
      );
      return;
    }
    const rawValue = (params as { raw?: unknown }).raw;
    if (typeof rawValue !== "string") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "invalid config.patch params: raw (string) required",
        ),
      );
      return;
    }
    const parsedRes = parseConfigJson5(rawValue);
    if (!parsedRes.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsedRes.error));
      return;
    }
    if (
      !parsedRes.parsed ||
      typeof parsedRes.parsed !== "object" ||
      Array.isArray(parsedRes.parsed)
    ) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "config.patch raw must be an object"),
      );
      return;
    }
    const merged = applyMergePatch(snapshot.config, parsedRes.parsed);
    let restoredMerge: unknown;
    try {
      restoredMerge = restoreRedactedValues(merged, snapshot.config);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, String(err instanceof Error ? err.message : err)),
      );
      return;
    }
    const migrated = applyLegacyMigrations(restoredMerge);
    const resolved = migrated.next ?? restoredMerge;
    const validated = validateConfigObjectWithPlugins(resolved);
    if (!validated.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
          details: { issues: validated.issues },
        }),
      );
      return;
    }
    await writeConfigFile(validated.config);

    const sessionKey =
      typeof (params as { sessionKey?: unknown }).sessionKey === "string"
        ? (params as { sessionKey?: string }).sessionKey?.trim() || undefined
        : undefined;
    const note =
      typeof (params as { note?: unknown }).note === "string"
        ? (params as { note?: string }).note?.trim() || undefined
        : undefined;
    const restartDelayMsRaw = (params as { restartDelayMs?: unknown }).restartDelayMs;
    const restartDelayMs =
      typeof restartDelayMsRaw === "number" && Number.isFinite(restartDelayMsRaw)
        ? Math.max(0, Math.floor(restartDelayMsRaw))
        : undefined;

    const payload: RestartSentinelPayload = {
      kind: "config-apply",
      status: "ok",
      ts: Date.now(),
      sessionKey,
      message: note ?? null,
      doctorHint: formatDoctorNonInteractiveHint(),
      stats: {
        mode: "config.patch",
        root: CONFIG_PATH,
      },
    };
    let sentinelPath: string | null = null;
    try {
      sentinelPath = await writeRestartSentinel(payload);
    } catch {
      sentinelPath = null;
    }
    const restart = scheduleGatewaySigusr1Restart({
      delayMs: restartDelayMs,
      reason: "config.patch",
    });
    recordGatewayConfigChangeEvent({
      ts: Date.now(),
      requestId: req.id,
      method: "config.patch",
      path: CONFIG_PATH,
      userId: owner?.userId ?? null,
      userAlias: owner?.alias ?? null,
      principalId: owner?.principalId ?? null,
      actorRole: owner?.role ?? null,
      sourceRole: owner?.sourceRole ?? null,
      clientId:
        client && typeof client.connect?.client?.id === "string" ? client.connect.client.id : null,
      clientMode:
        client && typeof client.connect?.client?.mode === "string"
          ? client.connect.client.mode
          : null,
      sourceIp: resolveGatewayAuditSourceIp(client ?? {}),
      sessionKey: sessionKey ?? null,
      note: note ?? null,
      restartDelayMs: restartDelayMs ?? null,
    });
    respond(
      true,
      {
        ok: true,
        path: CONFIG_PATH,
        config: redactConfigObject(validated.config),
        restart,
        sentinel: {
          path: sentinelPath,
          payload,
        },
      },
      undefined,
    );
  },
  "config.apply": async ({ params, respond, req, owner, client }) => {
    if (!validateConfigApplyParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.apply params: ${formatValidationErrors(validateConfigApplyParams.errors)}`,
        ),
      );
      return;
    }
    const snapshot = await readConfigFileSnapshot();
    if (!requireConfigBaseHash(params, snapshot, respond)) {
      return;
    }
    const rawValue = (params as { raw?: unknown }).raw;
    if (typeof rawValue !== "string") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "invalid config.apply params: raw (string) required",
        ),
      );
      return;
    }
    const parsedRes = parseConfigJson5(rawValue);
    if (!parsedRes.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsedRes.error));
      return;
    }
    const validated = validateConfigObjectWithPlugins(parsedRes.parsed);
    if (!validated.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
          details: { issues: validated.issues },
        }),
      );
      return;
    }
    let restoredApply: typeof validated.config;
    try {
      restoredApply = restoreRedactedValues(
        validated.config,
        snapshot.config,
      ) as typeof validated.config;
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, String(err instanceof Error ? err.message : err)),
      );
      return;
    }
    await writeConfigFile(restoredApply);

    const sessionKey =
      typeof (params as { sessionKey?: unknown }).sessionKey === "string"
        ? (params as { sessionKey?: string }).sessionKey?.trim() || undefined
        : undefined;
    const note =
      typeof (params as { note?: unknown }).note === "string"
        ? (params as { note?: string }).note?.trim() || undefined
        : undefined;
    const restartDelayMsRaw = (params as { restartDelayMs?: unknown }).restartDelayMs;
    const restartDelayMs =
      typeof restartDelayMsRaw === "number" && Number.isFinite(restartDelayMsRaw)
        ? Math.max(0, Math.floor(restartDelayMsRaw))
        : undefined;

    const payload: RestartSentinelPayload = {
      kind: "config-apply",
      status: "ok",
      ts: Date.now(),
      sessionKey,
      message: note ?? null,
      doctorHint: formatDoctorNonInteractiveHint(),
      stats: {
        mode: "config.apply",
        root: CONFIG_PATH,
      },
    };
    let sentinelPath: string | null = null;
    try {
      sentinelPath = await writeRestartSentinel(payload);
    } catch {
      sentinelPath = null;
    }
    const restart = scheduleGatewaySigusr1Restart({
      delayMs: restartDelayMs,
      reason: "config.apply",
    });
    recordGatewayConfigChangeEvent({
      ts: Date.now(),
      requestId: req.id,
      method: "config.apply",
      path: CONFIG_PATH,
      userId: owner?.userId ?? null,
      userAlias: owner?.alias ?? null,
      principalId: owner?.principalId ?? null,
      actorRole: owner?.role ?? null,
      sourceRole: owner?.sourceRole ?? null,
      clientId:
        client && typeof client.connect?.client?.id === "string" ? client.connect.client.id : null,
      clientMode:
        client && typeof client.connect?.client?.mode === "string"
          ? client.connect.client.mode
          : null,
      sourceIp: resolveGatewayAuditSourceIp(client ?? {}),
      sessionKey: sessionKey ?? null,
      note: note ?? null,
      restartDelayMs: restartDelayMs ?? null,
    });
    respond(
      true,
      {
        ok: true,
        path: CONFIG_PATH,
        config: redactConfigObject(restoredApply),
        restart,
        sentinel: {
          path: sentinelPath,
          payload,
        },
      },
      undefined,
    );
  },
};
