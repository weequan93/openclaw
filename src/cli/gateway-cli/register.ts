import type { Command } from "commander";
import type { CostUsageSummary } from "../../infra/session-cost-usage.js";
import type { GatewayDiscoverOpts } from "./discover.js";
import { gatewayStatusCommand } from "../../commands/gateway-status.js";
import { formatHealthChannelLines, type HealthSummary } from "../../commands/health.js";
import { loadConfig, resolveConfigSnapshotHash } from "../../config/config.js";
import { discoverGatewayBeacons } from "../../infra/bonjour-discovery.js";
import { resolveWideAreaDiscoveryDomain } from "../../infra/widearea-dns.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { colorize, isRich, theme } from "../../terminal/theme.js";
import { formatTokenCount, formatUsd } from "../../utils/usage-format.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import {
  runDaemonInstall,
  runDaemonRestart,
  runDaemonStart,
  runDaemonStatus,
  runDaemonStop,
  runDaemonUninstall,
} from "../daemon-cli.js";
import { withProgress } from "../progress.js";
import { callGatewayCli, gatewayCallOpts } from "./call.js";
import {
  dedupeBeacons,
  parseDiscoverTimeoutMs,
  pickBeaconHost,
  pickGatewayPort,
  renderBeaconLines,
} from "./discover.js";
import { addGatewayRunCommand } from "./run.js";

function styleHealthChannelLine(line: string, rich: boolean): string {
  if (!rich) {
    return line;
  }
  const colon = line.indexOf(":");
  if (colon === -1) {
    return line;
  }

  const label = line.slice(0, colon + 1);
  const detail = line.slice(colon + 1).trimStart();
  const normalized = detail.toLowerCase();

  const applyPrefix = (prefix: string, color: (value: string) => string) =>
    `${label} ${color(detail.slice(0, prefix.length))}${detail.slice(prefix.length)}`;

  if (normalized.startsWith("failed")) {
    return applyPrefix("failed", theme.error);
  }
  if (normalized.startsWith("ok")) {
    return applyPrefix("ok", theme.success);
  }
  if (normalized.startsWith("linked")) {
    return applyPrefix("linked", theme.success);
  }
  if (normalized.startsWith("configured")) {
    return applyPrefix("configured", theme.success);
  }
  if (normalized.startsWith("not linked")) {
    return applyPrefix("not linked", theme.warn);
  }
  if (normalized.startsWith("not configured")) {
    return applyPrefix("not configured", theme.muted);
  }
  if (normalized.startsWith("unknown")) {
    return applyPrefix("unknown", theme.warn);
  }

  return line;
}

function runGatewayCommand(action: () => Promise<void>, label?: string) {
  return runCommandWithRuntime(defaultRuntime, action, (err) => {
    const message = String(err);
    defaultRuntime.error(label ? `${label}: ${message}` : message);
    defaultRuntime.exit(1);
  });
}

function parseDaysOption(raw: unknown, fallback = 30): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(1, Math.floor(raw));
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.floor(parsed));
    }
  }
  return fallback;
}

function parseOptionalNonNegativeInt(raw: unknown, label: string): number | undefined {
  if (typeof raw !== "string" || raw.trim() === "") {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return Math.floor(parsed);
}

function parsePositiveIntOption(raw: unknown, fallback: number, label: string): number {
  if (typeof raw !== "string" || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Math.floor(parsed);
}

const OWNERSHIP_BACKFILL_RESOURCES = new Set(["agents", "sessions", "nodes", "browserProfiles"]);
const GATEWAY_POLICY_BUNDLE_IDS = new Set([
  "single_user",
  "multi_user_isolated",
  "strict_admin_control",
]);

function parseOwnershipBackfillResources(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const tokens = raw
    .flatMap((entry) => String(entry ?? "").split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return undefined;
  }
  const unique = Array.from(new Set(tokens));
  for (const token of unique) {
    if (!OWNERSHIP_BACKFILL_RESOURCES.has(token)) {
      throw new Error(
        `resource must be one of: ${Array.from(OWNERSHIP_BACKFILL_RESOURCES).join(", ")}`,
      );
    }
  }
  return unique;
}

function parseGatewayPolicyBundleId(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(
      `bundle is required and must be one of: ${Array.from(GATEWAY_POLICY_BUNDLE_IDS).join(", ")}`,
    );
  }
  const bundleId = raw.trim();
  if (!GATEWAY_POLICY_BUNDLE_IDS.has(bundleId)) {
    throw new Error(`bundle must be one of: ${Array.from(GATEWAY_POLICY_BUNDLE_IDS).join(", ")}`);
  }
  return bundleId;
}

function renderCostUsageSummary(summary: CostUsageSummary, days: number, rich: boolean): string[] {
  const totalCost = formatUsd(summary.totals.totalCost) ?? "$0.00";
  const totalTokens = formatTokenCount(summary.totals.totalTokens) ?? "0";
  const lines = [
    colorize(rich, theme.heading, `Usage cost (${days} days)`),
    `${colorize(rich, theme.muted, "Total:")} ${totalCost} · ${totalTokens} tokens`,
  ];

  if (summary.totals.missingCostEntries > 0) {
    lines.push(
      `${colorize(rich, theme.muted, "Missing entries:")} ${summary.totals.missingCostEntries}`,
    );
  }

  const latest = summary.daily.at(-1);
  if (latest) {
    const latestCost = formatUsd(latest.totalCost) ?? "$0.00";
    const latestTokens = formatTokenCount(latest.totalTokens) ?? "0";
    lines.push(
      `${colorize(rich, theme.muted, "Latest day:")} ${latest.date} · ${latestCost} · ${latestTokens} tokens`,
    );
  }

  return lines;
}

export function registerGatewayCli(program: Command) {
  const gateway = addGatewayRunCommand(
    program
      .command("gateway")
      .description("Run the WebSocket Gateway")
      .addHelpText(
        "after",
        () =>
          `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/gateway", "docs.openclaw.ai/cli/gateway")}\n`,
      ),
  );

  addGatewayRunCommand(
    gateway.command("run").description("Run the WebSocket Gateway (foreground)"),
  );

  gateway
    .command("status")
    .description("Show gateway service status + probe the Gateway")
    .option("--url <url>", "Gateway WebSocket URL (defaults to config/remote/local)")
    .option("--token <token>", "Gateway token (if required)")
    .option("--password <password>", "Gateway password (password auth)")
    .option("--timeout <ms>", "Timeout in ms", "10000")
    .option("--no-probe", "Skip RPC probe")
    .option("--deep", "Scan system-level services", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runDaemonStatus({
        rpc: opts,
        probe: Boolean(opts.probe),
        deep: Boolean(opts.deep),
        json: Boolean(opts.json),
      });
    });

  gateway
    .command("install")
    .description("Install the Gateway service (launchd/systemd/schtasks)")
    .option("--port <port>", "Gateway port")
    .option("--runtime <runtime>", "Daemon runtime (node|bun). Default: node")
    .option("--token <token>", "Gateway token (token auth)")
    .option("--force", "Reinstall/overwrite if already installed", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runDaemonInstall(opts);
    });

  gateway
    .command("uninstall")
    .description("Uninstall the Gateway service (launchd/systemd/schtasks)")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runDaemonUninstall(opts);
    });

  gateway
    .command("start")
    .description("Start the Gateway service (launchd/systemd/schtasks)")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runDaemonStart(opts);
    });

  gateway
    .command("stop")
    .description("Stop the Gateway service (launchd/systemd/schtasks)")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runDaemonStop(opts);
    });

  gateway
    .command("restart")
    .description("Restart the Gateway service (launchd/systemd/schtasks)")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runDaemonRestart(opts);
    });

  gatewayCallOpts(
    gateway
      .command("call")
      .description("Call a Gateway method")
      .argument("<method>", "Method name (health/status/system-presence/cron.*)")
      .option("--params <json>", "JSON object string for params", "{}")
      .action(async (method, opts) => {
        await runGatewayCommand(async () => {
          const params = JSON.parse(String(opts.params ?? "{}"));
          const result = await callGatewayCli(method, opts, params);
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(result, null, 2));
            return;
          }
          const rich = isRich();
          defaultRuntime.log(
            `${colorize(rich, theme.heading, "Gateway call")}: ${colorize(rich, theme.muted, String(method))}`,
          );
          defaultRuntime.log(JSON.stringify(result, null, 2));
        }, "Gateway call failed");
      }),
  );

  gatewayCallOpts(
    gateway
      .command("usage-cost")
      .description("Fetch usage cost summary from session logs")
      .option("--days <days>", "Number of days to include", "30")
      .action(async (opts) => {
        await runGatewayCommand(async () => {
          const days = parseDaysOption(opts.days);
          const result = await callGatewayCli("usage.cost", opts, { days });
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(result, null, 2));
            return;
          }
          const rich = isRich();
          const summary = result as CostUsageSummary;
          for (const line of renderCostUsageSummary(summary, days, rich)) {
            defaultRuntime.log(line);
          }
        }, "Gateway usage cost failed");
      }),
  );

  gatewayCallOpts(
    gateway
      .command("authz-denied")
      .description("List recent gateway authorization deny events (admin)")
      .option("--limit <n>", "Max events to return", "100")
      .option("--cursor <cursor>", "Pagination cursor from a previous result")
      .option("--order <order>", "Sort order for the returned page (desc|asc)", "desc")
      .option("--method <method>", "Filter by method")
      .option("--reason <reasonCode>", "Filter by deny reason code")
      .option("--user-id <userId>", "Filter by user ID")
      .option("--principal-id <principalId>", "Filter by principal ID")
      .option("--since <ms>", "Filter events after timestamp (epoch ms)")
      .option("--until <ms>", "Filter events before timestamp (epoch ms)")
      .action(async (opts) => {
        await runGatewayCommand(async () => {
          const limit = parsePositiveIntOption(opts.limit, 100, "limit");
          const cursor =
            typeof opts.cursor === "string" && opts.cursor.trim() ? opts.cursor.trim() : undefined;
          const orderRaw =
            typeof opts.order === "string" && opts.order.trim() ? opts.order.trim() : "desc";
          if (orderRaw !== "asc" && orderRaw !== "desc") {
            throw new Error("order must be either desc or asc");
          }
          const order = orderRaw as "asc" | "desc";
          const sinceTs = parseOptionalNonNegativeInt(opts.since, "since");
          const untilTs = parseOptionalNonNegativeInt(opts.until, "until");
          const method =
            typeof opts.method === "string" && opts.method.trim() ? opts.method.trim() : undefined;
          const reasonCode =
            typeof opts.reason === "string" && opts.reason.trim() ? opts.reason.trim() : undefined;
          const userId =
            typeof opts.userId === "string" && opts.userId.trim() ? opts.userId.trim() : undefined;
          const principalId =
            typeof opts.principalId === "string" && opts.principalId.trim()
              ? opts.principalId.trim()
              : undefined;
          const result = (await callGatewayCli("authz.denied.list", opts, {
            limit,
            ...(cursor ? { cursor } : {}),
            ...(order !== "desc" ? { order } : {}),
            ...(method ? { method } : {}),
            ...(reasonCode ? { reasonCode } : {}),
            ...(userId ? { userId } : {}),
            ...(principalId ? { principalId } : {}),
            ...(sinceTs !== undefined ? { sinceTs } : {}),
            ...(untilTs !== undefined ? { untilTs } : {}),
          })) as {
            ts?: number;
            nextCursor?: string | null;
            hasMore?: boolean;
            events?: Array<{
              ts?: number;
              method?: string;
              reasonCode?: string;
              requestId?: string;
              userId?: string | null;
              principalId?: string | null;
              errorMessage?: string;
            }>;
          };
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(result, null, 2));
            return;
          }
          const rich = isRich();
          defaultRuntime.log(colorize(rich, theme.heading, "Authz Denied Events"));
          const events = Array.isArray(result.events) ? result.events : [];
          if (events.length === 0) {
            defaultRuntime.log(colorize(rich, theme.muted, "No denied authorization events."));
            return;
          }
          for (const event of events) {
            const ts =
              typeof event.ts === "number" && Number.isFinite(event.ts)
                ? new Date(event.ts).toISOString()
                : "unknown-time";
            const actor = event.principalId ?? event.userId ?? "unknown-actor";
            defaultRuntime.log(
              `${colorize(rich, theme.muted, ts)} ${event.reasonCode ?? "UNKNOWN"} ${event.method ?? "unknown"} ${actor} ${event.errorMessage ?? ""}`.trim(),
            );
          }
          if (result.hasMore && result.nextCursor) {
            defaultRuntime.log(colorize(rich, theme.muted, `next cursor: ${result.nextCursor}`));
          }
        }, "Gateway authz denied failed");
      }),
  );

  gatewayCallOpts(
    gateway
      .command("authz-denied-summary")
      .description("Summarize gateway authorization deny events (admin)")
      .option("--top-n <n>", "Max buckets per summary group", "5")
      .option("--alert-threshold <n>", "Count threshold for high-frequency principals", "5")
      .option("--method <method>", "Filter by method")
      .option("--reason <reasonCode>", "Filter by deny reason code")
      .option("--error-code <errorCode>", "Filter by error code")
      .option("--user-id <userId>", "Filter by user ID")
      .option("--principal-id <principalId>", "Filter by principal ID")
      .option("--since <ms>", "Filter events after timestamp (epoch ms)")
      .option("--until <ms>", "Filter events before timestamp (epoch ms)")
      .action(async (opts) => {
        await runGatewayCommand(async () => {
          const topN = parsePositiveIntOption(opts.topN, 5, "top-n");
          const alertThreshold = parsePositiveIntOption(opts.alertThreshold, 5, "alert-threshold");
          const sinceTs = parseOptionalNonNegativeInt(opts.since, "since");
          const untilTs = parseOptionalNonNegativeInt(opts.until, "until");
          const method =
            typeof opts.method === "string" && opts.method.trim() ? opts.method.trim() : undefined;
          const reasonCode =
            typeof opts.reason === "string" && opts.reason.trim() ? opts.reason.trim() : undefined;
          const errorCode =
            typeof opts.errorCode === "string" && opts.errorCode.trim()
              ? opts.errorCode.trim()
              : undefined;
          const userId =
            typeof opts.userId === "string" && opts.userId.trim() ? opts.userId.trim() : undefined;
          const principalId =
            typeof opts.principalId === "string" && opts.principalId.trim()
              ? opts.principalId.trim()
              : undefined;

          const result = (await callGatewayCli("authz.denied.summary", opts, {
            topN,
            alertThreshold,
            ...(method ? { method } : {}),
            ...(reasonCode ? { reasonCode } : {}),
            ...(errorCode ? { errorCode } : {}),
            ...(userId ? { userId } : {}),
            ...(principalId ? { principalId } : {}),
            ...(sinceTs !== undefined ? { sinceTs } : {}),
            ...(untilTs !== undefined ? { untilTs } : {}),
          })) as {
            ts?: number;
            total?: number;
            byReasonCode?: Array<{ key?: string; count?: number }>;
            byMethod?: Array<{ key?: string; count?: number }>;
            byPrincipalId?: Array<{ key?: string; count?: number }>;
            highFrequency?: {
              threshold?: number;
              principals?: Array<{ key?: string; count?: number }>;
            };
          };

          if (opts.json) {
            defaultRuntime.log(JSON.stringify(result, null, 2));
            return;
          }

          const rich = isRich();
          defaultRuntime.log(colorize(rich, theme.heading, "Authz Denied Summary"));
          defaultRuntime.log(`${colorize(rich, theme.muted, "Total:")} ${result.total ?? 0}`);

          const renderBuckets = (label: string, rows?: Array<{ key?: string; count?: number }>) => {
            const items = Array.isArray(rows) ? rows : [];
            if (items.length === 0) {
              defaultRuntime.log(`${colorize(rich, theme.muted, `${label}:`)} none`);
              return;
            }
            const formatted = items
              .map((row) => `${row.key ?? "unknown"}=${row.count ?? 0}`)
              .join(", ");
            defaultRuntime.log(`${colorize(rich, theme.muted, `${label}:`)} ${formatted}`);
          };

          renderBuckets("Top reasons", result.byReasonCode);
          renderBuckets("Top methods", result.byMethod);
          renderBuckets("Top principals", result.byPrincipalId);
          renderBuckets(
            `High frequency (>=${result.highFrequency?.threshold ?? alertThreshold})`,
            result.highFrequency?.principals,
          );
        }, "Gateway authz denied summary failed");
      }),
  );

  gatewayCallOpts(
    gateway
      .command("config-changes")
      .description("List recent gateway config change events (admin)")
      .option("--limit <n>", "Max events to return", "100")
      .option("--cursor <cursor>", "Pagination cursor from a previous result")
      .option("--order <order>", "Sort order for the returned page (desc|asc)", "desc")
      .option("--method <method>", "Filter by method")
      .option("--policy-bundles", "Shortcut for --method config.policyBundle.apply", false)
      .option("--user-id <userId>", "Filter by user ID")
      .option("--principal-id <principalId>", "Filter by principal ID")
      .option("--since <ms>", "Filter events after timestamp (epoch ms)")
      .option("--until <ms>", "Filter events before timestamp (epoch ms)")
      .action(async (opts) => {
        await runGatewayCommand(async () => {
          const limit = parsePositiveIntOption(opts.limit, 100, "limit");
          const cursor =
            typeof opts.cursor === "string" && opts.cursor.trim() ? opts.cursor.trim() : undefined;
          const orderRaw =
            typeof opts.order === "string" && opts.order.trim() ? opts.order.trim() : "desc";
          if (orderRaw !== "asc" && orderRaw !== "desc") {
            throw new Error("order must be either desc or asc");
          }
          const order = orderRaw as "asc" | "desc";
          const sinceTs = parseOptionalNonNegativeInt(opts.since, "since");
          const untilTs = parseOptionalNonNegativeInt(opts.until, "until");
          const method =
            typeof opts.method === "string" && opts.method.trim() ? opts.method.trim() : undefined;
          const policyBundlesOnly = opts.policyBundles === true;
          if (policyBundlesOnly && method && method !== "config.policyBundle.apply") {
            throw new Error(
              "policy-bundles filter cannot be combined with a different method filter",
            );
          }
          const methodFilter = policyBundlesOnly ? "config.policyBundle.apply" : method;
          const userId =
            typeof opts.userId === "string" && opts.userId.trim() ? opts.userId.trim() : undefined;
          const principalId =
            typeof opts.principalId === "string" && opts.principalId.trim()
              ? opts.principalId.trim()
              : undefined;
          const result = (await callGatewayCli("config.changes.list", opts, {
            limit,
            ...(cursor ? { cursor } : {}),
            ...(order !== "desc" ? { order } : {}),
            ...(methodFilter ? { method: methodFilter } : {}),
            ...(userId ? { userId } : {}),
            ...(principalId ? { principalId } : {}),
            ...(sinceTs !== undefined ? { sinceTs } : {}),
            ...(untilTs !== undefined ? { untilTs } : {}),
          })) as {
            ts?: number;
            nextCursor?: string | null;
            hasMore?: boolean;
            events?: Array<{
              ts?: number;
              method?: string;
              requestId?: string;
              userId?: string | null;
              userAlias?: string | null;
              principalId?: string | null;
              note?: string | null;
            }>;
          };
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(result, null, 2));
            return;
          }
          const rich = isRich();
          defaultRuntime.log(colorize(rich, theme.heading, "Gateway Config Changes"));
          const events = Array.isArray(result.events) ? result.events : [];
          if (events.length === 0) {
            defaultRuntime.log(colorize(rich, theme.muted, "No config change events."));
            return;
          }
          for (const event of events) {
            const ts =
              typeof event.ts === "number" && Number.isFinite(event.ts)
                ? new Date(event.ts).toISOString()
                : "unknown-time";
            const actor = event.principalId ?? event.userAlias ?? event.userId ?? "unknown-actor";
            const notePart = event.note ? ` note=${event.note}` : "";
            defaultRuntime.log(
              `${colorize(rich, theme.muted, ts)} ${event.method ?? "unknown"} ${actor}${notePart}`,
            );
          }
          if (result.hasMore && result.nextCursor) {
            defaultRuntime.log(colorize(rich, theme.muted, `next cursor: ${result.nextCursor}`));
          }
        }, "Gateway config changes failed");
      }),
  );

  gatewayCallOpts(
    gateway
      .command("policy-bundles")
      .description("List gateway policy bundles (admin)")
      .action(async (opts) => {
        await runGatewayCommand(async () => {
          const result = (await callGatewayCli("config.policyBundles.list", opts, {})) as {
            bundles?: Array<{
              id?: string;
              title?: string;
              description?: string;
            }>;
          };
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(result, null, 2));
            return;
          }
          const rich = isRich();
          defaultRuntime.log(colorize(rich, theme.heading, "Gateway Policy Bundles"));
          const bundles = Array.isArray(result.bundles) ? result.bundles : [];
          if (bundles.length === 0) {
            defaultRuntime.log(colorize(rich, theme.muted, "No policy bundles available."));
            return;
          }
          for (const bundle of bundles) {
            defaultRuntime.log(
              `${bundle.id ?? "unknown"}${bundle.title ? ` · ${bundle.title}` : ""}`,
            );
            if (bundle.description) {
              defaultRuntime.log(colorize(rich, theme.muted, `  ${bundle.description}`));
            }
          }
        }, "Gateway policy bundles failed");
      }),
  );

  gatewayCallOpts(
    gateway
      .command("policy-bundle-resolve")
      .description("Resolve a gateway policy bundle patch (admin)")
      .requiredOption(
        "--bundle <id>",
        "Bundle id: single_user|multi_user_isolated|strict_admin_control",
      )
      .action(async (opts) => {
        await runGatewayCommand(async () => {
          const bundleId = parseGatewayPolicyBundleId((opts as { bundle?: unknown }).bundle);
          const result = (await callGatewayCli("config.policyBundle.resolve", opts, {
            bundleId,
          })) as {
            bundle?: {
              id?: string;
              title?: string;
              description?: string;
              patch?: unknown;
            };
          };
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(result, null, 2));
            return;
          }
          const rich = isRich();
          defaultRuntime.log(colorize(rich, theme.heading, "Gateway Policy Bundle"));
          const bundle = result.bundle;
          if (!bundle) {
            defaultRuntime.log(colorize(rich, theme.muted, "No bundle payload returned."));
            return;
          }
          defaultRuntime.log(`${bundle.id ?? bundleId}${bundle.title ? ` · ${bundle.title}` : ""}`);
          if (bundle.description) {
            defaultRuntime.log(colorize(rich, theme.muted, bundle.description));
          }
          defaultRuntime.log(JSON.stringify(bundle.patch ?? {}, null, 2));
        }, "Gateway policy bundle resolve failed");
      }),
  );

  gatewayCallOpts(
    gateway
      .command("policy-bundle-apply")
      .description("Apply a gateway policy bundle and restart (admin)")
      .requiredOption(
        "--bundle <id>",
        "Bundle id: single_user|multi_user_isolated|strict_admin_control",
      )
      .option("--session-key <sessionKey>", "Session key for restart wake notification")
      .option("--note <note>", "Optional admin note stored in config change log")
      .option("--restart-delay <ms>", "Restart delay in ms")
      .action(async (opts) => {
        await runGatewayCommand(async () => {
          const bundleId = parseGatewayPolicyBundleId((opts as { bundle?: unknown }).bundle);
          const note =
            typeof (opts as { note?: unknown }).note === "string" &&
            (opts as { note?: string }).note?.trim()
              ? (opts as { note?: string }).note?.trim()
              : undefined;
          const restartDelayMs = parseOptionalNonNegativeInt(
            (opts as { restartDelay?: unknown }).restartDelay,
            "restart-delay",
          );
          const sessionKey =
            typeof (opts as { sessionKey?: unknown }).sessionKey === "string" &&
            (opts as { sessionKey?: string }).sessionKey?.trim()
              ? (opts as { sessionKey?: string }).sessionKey?.trim()
              : undefined;

          const snapshot = (await callGatewayCli("config.get", opts, {})) as {
            hash?: string;
            raw?: string;
          };
          const baseHash = resolveConfigSnapshotHash({
            hash: snapshot.hash,
            raw: snapshot.raw,
          });
          const defaultNote = `policy-bundle:${bundleId}`;

          const applyParams = {
            bundleId,
            ...(baseHash ? { baseHash } : {}),
            ...(sessionKey ? { sessionKey } : {}),
            ...(note ? { note } : { note: defaultNote }),
            ...(restartDelayMs !== undefined ? { restartDelayMs } : {}),
          };

          const result = await (async () => {
            try {
              return await callGatewayCli("config.policyBundle.apply", opts, applyParams);
            } catch (err) {
              const message = String(err);
              if (!message.toLowerCase().includes("unknown method")) {
                throw err;
              }
              const resolved = (await callGatewayCli("config.policyBundle.resolve", opts, {
                bundleId,
              })) as { bundle?: { patch?: unknown } };
              const patch = resolved.bundle?.patch;
              if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
                throw new Error("policy bundle resolve returned invalid patch payload", {
                  cause: err,
                });
              }
              return await callGatewayCli("config.patch", opts, {
                raw: JSON.stringify(patch, null, 2),
                ...(baseHash ? { baseHash } : {}),
                ...(sessionKey ? { sessionKey } : {}),
                ...(note ? { note } : { note: defaultNote }),
                ...(restartDelayMs !== undefined ? { restartDelayMs } : {}),
              });
            }
          })();

          if (opts.json) {
            defaultRuntime.log(JSON.stringify(result, null, 2));
            return;
          }
          const rich = isRich();
          defaultRuntime.log(colorize(rich, theme.heading, "Policy Bundle Applied"));
          defaultRuntime.log(
            `${colorize(rich, theme.muted, "Bundle:")} ${bundleId}${baseHash ? "" : " (no base hash)"}`,
          );
          defaultRuntime.log(JSON.stringify(result, null, 2));
        }, "Gateway policy bundle apply failed");
      }),
  );

  gatewayCallOpts(
    gateway
      .command("ownership-gaps")
      .description("List resources missing owner metadata (admin)")
      .option(
        "--resource <name>",
        "Resource filter (repeatable): agents|sessions|nodes|browserProfiles",
        (value, prev: string[]) => [...prev, value],
        [],
      )
      .option("--limit <n>", "Max sample entries per resource (default: 50)", "50")
      .action(async (opts) => {
        await runGatewayCommand(async () => {
          const resources = parseOwnershipBackfillResources(opts.resource);
          const limit = parsePositiveIntOption(opts.limit, 50, "limit");
          const result = await callGatewayCli("ownership.gaps", opts, {
            limit,
            ...(resources ? { resources } : {}),
          });
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(result, null, 2));
            return;
          }
          const rich = isRich();
          const typed = result as {
            limit?: number;
            summary?: { scanned?: number; missing?: number };
            resourcesSummary?: Record<string, { scanned?: number; missing?: number }>;
          };
          defaultRuntime.log(colorize(rich, theme.heading, "Ownership Gaps"));
          defaultRuntime.log(`${colorize(rich, theme.muted, "Limit:")} ${typed.limit ?? limit}`);
          const summary = typed.summary ?? {};
          defaultRuntime.log(
            `${colorize(rich, theme.muted, "Summary:")} scanned=${summary.scanned ?? 0} missing=${summary.missing ?? 0}`,
          );
          const resourcesObj = typed.resourcesSummary ?? {};
          for (const [name, stats] of Object.entries(resourcesObj)) {
            defaultRuntime.log(
              `${colorize(rich, theme.muted, name)} scanned=${stats.scanned ?? 0} missing=${stats.missing ?? 0}`,
            );
          }
        }, "Gateway ownership gaps failed");
      }),
  );

  gatewayCallOpts(
    gateway
      .command("ownership-backfill")
      .description("Backfill missing owner metadata for multi-user migration (admin)")
      .requiredOption("--owner-user <userId>", "Owner user UUID used for missing ownership")
      .option("--owner-principal <principalId>", "Owner principal ID for session ownership stamp")
      .option(
        "--resource <name>",
        "Resource filter (repeatable): agents|sessions|nodes|browserProfiles",
        (value, prev: string[]) => [...prev, value],
        [],
      )
      .option("--dry-run", "Preview changes without writing data", false)
      .action(async (opts) => {
        await runGatewayCommand(async () => {
          const ownerUserId =
            typeof opts.ownerUser === "string" && opts.ownerUser.trim()
              ? opts.ownerUser.trim()
              : "";
          if (!ownerUserId) {
            throw new Error("owner-user is required");
          }
          const ownerPrincipalId =
            typeof opts.ownerPrincipal === "string" && opts.ownerPrincipal.trim()
              ? opts.ownerPrincipal.trim()
              : undefined;
          const resources = parseOwnershipBackfillResources(opts.resource);
          const dryRun = opts.dryRun === true;
          const result = await callGatewayCli("ownership.backfill", opts, {
            ownerUserId,
            ...(ownerPrincipalId ? { ownerPrincipalId } : {}),
            ...(resources ? { resources } : {}),
            ...(dryRun ? { dryRun: true } : {}),
          });
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(result, null, 2));
            return;
          }
          const rich = isRich();
          const typed = result as {
            dryRun?: boolean;
            ownerUserId?: string;
            summary?: { scanned?: number; updated?: number; skipped?: number };
            resources?: Record<string, { scanned?: number; updated?: number; skipped?: number }>;
          };
          defaultRuntime.log(colorize(rich, theme.heading, "Ownership Backfill"));
          defaultRuntime.log(
            `${colorize(rich, theme.muted, "Owner:")} ${typed.ownerUserId ?? ownerUserId}`,
          );
          defaultRuntime.log(
            `${colorize(rich, theme.muted, "Mode:")} ${typed.dryRun ? "dry-run" : "apply"}`,
          );
          const summary = typed.summary ?? {};
          defaultRuntime.log(
            `${colorize(rich, theme.muted, "Summary:")} scanned=${summary.scanned ?? 0} updated=${summary.updated ?? 0} skipped=${summary.skipped ?? 0}`,
          );
          const resourcesObj = typed.resources ?? {};
          for (const [name, stats] of Object.entries(resourcesObj)) {
            defaultRuntime.log(
              `${colorize(rich, theme.muted, name)} scanned=${stats.scanned ?? 0} updated=${stats.updated ?? 0} skipped=${stats.skipped ?? 0}`,
            );
          }
        }, "Gateway ownership backfill failed");
      }),
  );

  gatewayCallOpts(
    gateway
      .command("health")
      .description("Fetch Gateway health")
      .action(async (opts) => {
        await runGatewayCommand(async () => {
          const result = await callGatewayCli("health", opts);
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(result, null, 2));
            return;
          }
          const rich = isRich();
          const obj: Record<string, unknown> = result && typeof result === "object" ? result : {};
          const durationMs = typeof obj.durationMs === "number" ? obj.durationMs : null;
          defaultRuntime.log(colorize(rich, theme.heading, "Gateway Health"));
          defaultRuntime.log(
            `${colorize(rich, theme.success, "OK")}${durationMs != null ? ` (${durationMs}ms)` : ""}`,
          );
          if (obj.channels && typeof obj.channels === "object") {
            for (const line of formatHealthChannelLines(obj as HealthSummary)) {
              defaultRuntime.log(styleHealthChannelLine(line, rich));
            }
          }
        });
      }),
  );

  gateway
    .command("probe")
    .description("Show gateway reachability + discovery + health + status summary (local + remote)")
    .option("--url <url>", "Explicit Gateway WebSocket URL (still probes localhost)")
    .option("--ssh <target>", "SSH target for remote gateway tunnel (user@host or user@host:port)")
    .option("--ssh-identity <path>", "SSH identity file path")
    .option("--ssh-auto", "Try to derive an SSH target from Bonjour discovery", false)
    .option("--token <token>", "Gateway token (applies to all probes)")
    .option("--password <password>", "Gateway password (applies to all probes)")
    .option("--timeout <ms>", "Overall probe budget in ms", "3000")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runGatewayCommand(async () => {
        await gatewayStatusCommand(opts, defaultRuntime);
      });
    });

  gateway
    .command("discover")
    .description("Discover gateways via Bonjour (local + wide-area if configured)")
    .option("--timeout <ms>", "Per-command timeout in ms", "2000")
    .option("--json", "Output JSON", false)
    .action(async (opts: GatewayDiscoverOpts) => {
      await runGatewayCommand(async () => {
        const cfg = loadConfig();
        const wideAreaDomain = resolveWideAreaDiscoveryDomain({
          configDomain: cfg.discovery?.wideArea?.domain,
        });
        const timeoutMs = parseDiscoverTimeoutMs(opts.timeout, 2000);
        const domains = ["local.", ...(wideAreaDomain ? [wideAreaDomain] : [])];
        const beacons = await withProgress(
          {
            label: "Scanning for gateways…",
            indeterminate: true,
            enabled: opts.json !== true,
            delayMs: 0,
          },
          async () => await discoverGatewayBeacons({ timeoutMs, wideAreaDomain }),
        );

        const deduped = dedupeBeacons(beacons).toSorted((a, b) =>
          String(a.displayName || a.instanceName).localeCompare(
            String(b.displayName || b.instanceName),
          ),
        );

        if (opts.json) {
          const enriched = deduped.map((b) => {
            const host = pickBeaconHost(b);
            const port = pickGatewayPort(b);
            return { ...b, wsUrl: host ? `ws://${host}:${port}` : null };
          });
          defaultRuntime.log(
            JSON.stringify(
              {
                timeoutMs,
                domains,
                count: enriched.length,
                beacons: enriched,
              },
              null,
              2,
            ),
          );
          return;
        }

        const rich = isRich();
        defaultRuntime.log(colorize(rich, theme.heading, "Gateway Discovery"));
        defaultRuntime.log(
          colorize(
            rich,
            theme.muted,
            `Found ${deduped.length} gateway(s) · domains: ${domains.join(", ")}`,
          ),
        );
        if (deduped.length === 0) {
          return;
        }

        for (const beacon of deduped) {
          for (const line of renderBeaconLines(beacon, rich)) {
            defaultRuntime.log(line);
          }
        }
      }, "gateway discover failed");
    });
}
