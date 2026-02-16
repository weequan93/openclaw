export type GatewayAuthzAllowEvent = {
  ts: number;
  requestId: string;
  method: string;
  userId: string | null;
  userAlias?: string | null;
  principalId: string | null;
  actorRole: string | null;
  sourceRole: string | null;
  clientId?: string | null;
  clientMode?: string | null;
  sourceIp?: string | null;
};

type ListAuthzAllowParams = {
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

type SummarizeAuthzAllowParams = {
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
  topN?: number;
  alertThreshold?: number;
};

export type GatewayAuthzAllowPage = {
  events: GatewayAuthzAllowEvent[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type GatewayAuthzAllowSummaryBucket = {
  key: string;
  count: number;
};

export type GatewayAuthzAllowSummary = {
  total: number;
  earliestTs?: number;
  latestTs?: number;
  window: {
    sinceTs?: number;
    untilTs?: number;
  };
  byMethod: GatewayAuthzAllowSummaryBucket[];
  byActorRole: GatewayAuthzAllowSummaryBucket[];
  bySourceRole: GatewayAuthzAllowSummaryBucket[];
  byUserId: GatewayAuthzAllowSummaryBucket[];
  byPrincipalId: GatewayAuthzAllowSummaryBucket[];
  byClientId: GatewayAuthzAllowSummaryBucket[];
  byClientMode: GatewayAuthzAllowSummaryBucket[];
  bySourceIp: GatewayAuthzAllowSummaryBucket[];
  highFrequency: {
    threshold: number;
    principals: GatewayAuthzAllowSummaryBucket[];
    sourceIps: GatewayAuthzAllowSummaryBucket[];
  };
};

const MAX_ALLOW_EVENTS = 2000;
type GatewayAuthzAllowEventRecord = GatewayAuthzAllowEvent & { seq: number };
const allowEvents: GatewayAuthzAllowEventRecord[] = [];
let allowSeq = 0;

function normalizeToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function recordGatewayAuthzAllowEvent(event: GatewayAuthzAllowEvent): void {
  allowEvents.push({ ...event, seq: ++allowSeq });
  if (allowEvents.length > MAX_ALLOW_EVENTS) {
    allowEvents.splice(0, allowEvents.length - MAX_ALLOW_EVENTS);
  }
}

function parseCursorSeq(raw: unknown): number | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function normalizeOrder(raw: unknown): "desc" | "asc" {
  return raw === "asc" ? "asc" : "desc";
}

function normalizeTopN(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 5;
  }
  return Math.max(1, Math.min(50, Math.floor(raw)));
}

function normalizeAlertThreshold(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 5;
  }
  return Math.max(1, Math.min(500, Math.floor(raw)));
}

function bucketizeAll(
  entries: GatewayAuthzAllowEventRecord[],
  selector: (entry: GatewayAuthzAllowEventRecord) => string | null | undefined,
): GatewayAuthzAllowSummaryBucket[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const raw = selector(entry);
    const key = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .toSorted((a, b) => (b.count === a.count ? a.key.localeCompare(b.key) : b.count - a.count));
}

function bucketize(
  entries: GatewayAuthzAllowEventRecord[],
  selector: (entry: GatewayAuthzAllowEventRecord) => string | null | undefined,
  topN: number,
): GatewayAuthzAllowSummaryBucket[] {
  return bucketizeAll(entries, selector).slice(0, topN);
}

export function listGatewayAuthzAllowEvents(
  params: ListAuthzAllowParams = {},
): GatewayAuthzAllowEvent[] {
  return listGatewayAuthzAllowEventsPage(params).events;
}

export function listGatewayAuthzAllowEventsPage(
  params: ListAuthzAllowParams = {},
): GatewayAuthzAllowPage {
  const order = normalizeOrder(params.order);
  const method = normalizeToken(params.method);
  const userId = normalizeToken(params.userId);
  const principalId = normalizeToken(params.principalId);
  const actorRole = normalizeToken(params.actorRole);
  const sourceRole = normalizeToken(params.sourceRole);
  const clientId = normalizeToken(params.clientId);
  const clientMode = normalizeToken(params.clientMode);
  const sourceIp = normalizeToken(params.sourceIp);
  const cursorSeq = parseCursorSeq(params.cursor);
  const sinceTs =
    typeof params.sinceTs === "number" && Number.isFinite(params.sinceTs)
      ? Math.floor(params.sinceTs)
      : undefined;
  const untilTs =
    typeof params.untilTs === "number" && Number.isFinite(params.untilTs)
      ? Math.floor(params.untilTs)
      : undefined;
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.min(500, Math.floor(params.limit)))
      : 100;

  let filtered = allowEvents;
  if (cursorSeq !== undefined) {
    filtered = filtered.filter((entry) => entry.seq < cursorSeq);
  }
  if (method) {
    filtered = filtered.filter((entry) => entry.method === method);
  }
  if (userId) {
    filtered = filtered.filter((entry) => entry.userId === userId);
  }
  if (principalId) {
    filtered = filtered.filter((entry) => entry.principalId === principalId);
  }
  if (actorRole) {
    filtered = filtered.filter((entry) => entry.actorRole === actorRole);
  }
  if (sourceRole) {
    filtered = filtered.filter((entry) => entry.sourceRole === sourceRole);
  }
  if (clientId) {
    filtered = filtered.filter((entry) => entry.clientId === clientId);
  }
  if (clientMode) {
    filtered = filtered.filter((entry) => entry.clientMode === clientMode);
  }
  if (sourceIp) {
    filtered = filtered.filter((entry) => entry.sourceIp === sourceIp);
  }
  if (sinceTs !== undefined) {
    filtered = filtered.filter((entry) => entry.ts >= sinceTs);
  }
  if (untilTs !== undefined) {
    filtered = filtered.filter((entry) => entry.ts <= untilTs);
  }

  const start = Math.max(0, filtered.length - limit);
  const window = filtered.slice(start);
  const rows = order === "asc" ? window : window.toReversed();
  const oldest = window[0];
  const hasMore = start > 0;
  return {
    events: rows.map(({ seq: _seq, ...event }) => event),
    nextCursor: hasMore && oldest ? String(oldest.seq) : null,
    hasMore,
  };
}

export function summarizeGatewayAuthzAllowEvents(
  params: SummarizeAuthzAllowParams = {},
): GatewayAuthzAllowSummary {
  const method = normalizeToken(params.method);
  const userId = normalizeToken(params.userId);
  const principalId = normalizeToken(params.principalId);
  const actorRole = normalizeToken(params.actorRole);
  const sourceRole = normalizeToken(params.sourceRole);
  const clientId = normalizeToken(params.clientId);
  const clientMode = normalizeToken(params.clientMode);
  const sourceIp = normalizeToken(params.sourceIp);
  const topN = normalizeTopN(params.topN);
  const alertThreshold = normalizeAlertThreshold(params.alertThreshold);
  const sinceTs =
    typeof params.sinceTs === "number" && Number.isFinite(params.sinceTs)
      ? Math.floor(params.sinceTs)
      : undefined;
  const untilTs =
    typeof params.untilTs === "number" && Number.isFinite(params.untilTs)
      ? Math.floor(params.untilTs)
      : undefined;

  let filtered = allowEvents;
  if (method) {
    filtered = filtered.filter((entry) => entry.method === method);
  }
  if (userId) {
    filtered = filtered.filter((entry) => entry.userId === userId);
  }
  if (principalId) {
    filtered = filtered.filter((entry) => entry.principalId === principalId);
  }
  if (actorRole) {
    filtered = filtered.filter((entry) => entry.actorRole === actorRole);
  }
  if (sourceRole) {
    filtered = filtered.filter((entry) => entry.sourceRole === sourceRole);
  }
  if (clientId) {
    filtered = filtered.filter((entry) => entry.clientId === clientId);
  }
  if (clientMode) {
    filtered = filtered.filter((entry) => entry.clientMode === clientMode);
  }
  if (sourceIp) {
    filtered = filtered.filter((entry) => entry.sourceIp === sourceIp);
  }
  if (sinceTs !== undefined) {
    filtered = filtered.filter((entry) => entry.ts >= sinceTs);
  }
  if (untilTs !== undefined) {
    filtered = filtered.filter((entry) => entry.ts <= untilTs);
  }

  const latestTs = filtered.length > 0 ? Math.max(...filtered.map((entry) => entry.ts)) : undefined;
  const earliestTs =
    filtered.length > 0 ? Math.min(...filtered.map((entry) => entry.ts)) : undefined;
  const principalBuckets = bucketizeAll(filtered, (entry) => entry.principalId);
  const highFrequencyPrincipals = principalBuckets
    .filter((entry) => entry.count >= alertThreshold)
    .slice(0, topN);
  const sourceIpBuckets = bucketizeAll(filtered, (entry) => entry.sourceIp);
  const highFrequencySourceIps = sourceIpBuckets
    .filter((entry) => entry.key !== "unknown" && entry.count >= alertThreshold)
    .slice(0, topN);

  return {
    total: filtered.length,
    ...(earliestTs !== undefined ? { earliestTs } : {}),
    ...(latestTs !== undefined ? { latestTs } : {}),
    window: {
      ...(sinceTs !== undefined ? { sinceTs } : {}),
      ...(untilTs !== undefined ? { untilTs } : {}),
    },
    byMethod: bucketize(filtered, (entry) => entry.method, topN),
    byActorRole: bucketize(filtered, (entry) => entry.actorRole, topN),
    bySourceRole: bucketize(filtered, (entry) => entry.sourceRole, topN),
    byUserId: bucketize(filtered, (entry) => entry.userId, topN),
    byPrincipalId: principalBuckets.slice(0, topN),
    byClientId: bucketize(filtered, (entry) => entry.clientId, topN),
    byClientMode: bucketize(filtered, (entry) => entry.clientMode, topN),
    bySourceIp: sourceIpBuckets.slice(0, topN),
    highFrequency: {
      threshold: alertThreshold,
      principals: highFrequencyPrincipals,
      sourceIps: highFrequencySourceIps,
    },
  };
}

export const __test = {
  clear(): void {
    allowEvents.length = 0;
    allowSeq = 0;
  },
};
