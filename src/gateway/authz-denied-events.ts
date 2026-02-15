export type GatewayAuthzDenyEvent = {
  ts: number;
  requestId: string;
  method: string;
  reasonCode: string;
  errorCode: string;
  errorMessage: string;
  userId: string | null;
  userAlias?: string | null;
  principalId: string | null;
  actorRole: string | null;
  sourceRole: string | null;
  clientId?: string | null;
  clientMode?: string | null;
  sourceIp?: string | null;
};

type ListAuthzDenyParams = {
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

type SummarizeAuthzDenyParams = {
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
  topN?: number;
  alertThreshold?: number;
};

export type GatewayAuthzDenyPage = {
  events: GatewayAuthzDenyEvent[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type GatewayAuthzDenySummaryBucket = {
  key: string;
  count: number;
};

export type GatewayAuthzDenySummary = {
  total: number;
  earliestTs?: number;
  latestTs?: number;
  window: {
    sinceTs?: number;
    untilTs?: number;
  };
  byReasonCode: GatewayAuthzDenySummaryBucket[];
  byMethod: GatewayAuthzDenySummaryBucket[];
  byActorRole: GatewayAuthzDenySummaryBucket[];
  bySourceRole: GatewayAuthzDenySummaryBucket[];
  byErrorCode: GatewayAuthzDenySummaryBucket[];
  byPrincipalId: GatewayAuthzDenySummaryBucket[];
  highFrequency: {
    threshold: number;
    principals: GatewayAuthzDenySummaryBucket[];
  };
};

const MAX_DENY_EVENTS = 2000;
type GatewayAuthzDenyEventRecord = GatewayAuthzDenyEvent & { seq: number };
const denyEvents: GatewayAuthzDenyEventRecord[] = [];
let denySeq = 0;

function normalizeToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function recordGatewayAuthzDenyEvent(event: GatewayAuthzDenyEvent): void {
  denyEvents.push({ ...event, seq: ++denySeq });
  if (denyEvents.length > MAX_DENY_EVENTS) {
    denyEvents.splice(0, denyEvents.length - MAX_DENY_EVENTS);
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
  entries: GatewayAuthzDenyEventRecord[],
  selector: (entry: GatewayAuthzDenyEventRecord) => string | null | undefined,
): GatewayAuthzDenySummaryBucket[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const raw = selector(entry);
    const key = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count === a.count ? a.key.localeCompare(b.key) : b.count - a.count));
}

function bucketize(
  entries: GatewayAuthzDenyEventRecord[],
  selector: (entry: GatewayAuthzDenyEventRecord) => string | null | undefined,
  topN: number,
): GatewayAuthzDenySummaryBucket[] {
  return bucketizeAll(entries, selector).slice(0, topN);
}

export function listGatewayAuthzDenyEvents(
  params: ListAuthzDenyParams = {},
): GatewayAuthzDenyEvent[] {
  return listGatewayAuthzDenyEventsPage(params).events;
}

export function listGatewayAuthzDenyEventsPage(
  params: ListAuthzDenyParams = {},
): GatewayAuthzDenyPage {
  const order = normalizeOrder(params.order);
  const method = normalizeToken(params.method);
  const reasonCode = normalizeToken(params.reasonCode);
  const errorCode = normalizeToken(params.errorCode);
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

  let filtered = denyEvents;
  if (cursorSeq !== undefined) {
    filtered = filtered.filter((entry) => entry.seq < cursorSeq);
  }
  if (method) {
    filtered = filtered.filter((entry) => entry.method === method);
  }
  if (reasonCode) {
    filtered = filtered.filter((entry) => entry.reasonCode === reasonCode);
  }
  if (errorCode) {
    filtered = filtered.filter((entry) => entry.errorCode === errorCode);
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

export function summarizeGatewayAuthzDenyEvents(
  params: SummarizeAuthzDenyParams = {},
): GatewayAuthzDenySummary {
  const method = normalizeToken(params.method);
  const reasonCode = normalizeToken(params.reasonCode);
  const errorCode = normalizeToken(params.errorCode);
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

  let filtered = denyEvents;
  if (method) {
    filtered = filtered.filter((entry) => entry.method === method);
  }
  if (reasonCode) {
    filtered = filtered.filter((entry) => entry.reasonCode === reasonCode);
  }
  if (errorCode) {
    filtered = filtered.filter((entry) => entry.errorCode === errorCode);
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

  return {
    total: filtered.length,
    ...(earliestTs !== undefined ? { earliestTs } : {}),
    ...(latestTs !== undefined ? { latestTs } : {}),
    window: {
      ...(sinceTs !== undefined ? { sinceTs } : {}),
      ...(untilTs !== undefined ? { untilTs } : {}),
    },
    byReasonCode: bucketize(filtered, (entry) => entry.reasonCode, topN),
    byMethod: bucketize(filtered, (entry) => entry.method, topN),
    byActorRole: bucketize(filtered, (entry) => entry.actorRole, topN),
    bySourceRole: bucketize(filtered, (entry) => entry.sourceRole, topN),
    byErrorCode: bucketize(filtered, (entry) => entry.errorCode, topN),
    byPrincipalId: principalBuckets.slice(0, topN),
    highFrequency: {
      threshold: alertThreshold,
      principals: highFrequencyPrincipals,
    },
  };
}

export const __test = {
  clear(): void {
    denyEvents.length = 0;
    denySeq = 0;
  },
};
