export type GatewayConfigChangeEvent = {
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

type ListGatewayConfigChangeParams = {
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

export type GatewayConfigChangePage = {
  events: GatewayConfigChangeEvent[];
  nextCursor: string | null;
  hasMore: boolean;
};

const MAX_CONFIG_CHANGE_EVENTS = 2000;
type GatewayConfigChangeEventRecord = GatewayConfigChangeEvent & { seq: number };
const configChangeEvents: GatewayConfigChangeEventRecord[] = [];
let configChangeSeq = 0;

function normalizeToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

export function recordGatewayConfigChangeEvent(event: GatewayConfigChangeEvent): void {
  configChangeEvents.push({ ...event, seq: ++configChangeSeq });
  if (configChangeEvents.length > MAX_CONFIG_CHANGE_EVENTS) {
    configChangeEvents.splice(0, configChangeEvents.length - MAX_CONFIG_CHANGE_EVENTS);
  }
}

export function listGatewayConfigChangeEvents(
  params: ListGatewayConfigChangeParams = {},
): GatewayConfigChangeEvent[] {
  return listGatewayConfigChangeEventsPage(params).events;
}

export function listGatewayConfigChangeEventsPage(
  params: ListGatewayConfigChangeParams = {},
): GatewayConfigChangePage {
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

  let filtered = configChangeEvents;
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

export const __test = {
  clear(): void {
    configChangeEvents.length = 0;
    configChangeSeq = 0;
  },
};
