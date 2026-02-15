import type { GatewayRequestHandlers } from "./types.js";
import {
  listGatewayAuthzDenyEventsPage,
  summarizeGatewayAuthzDenyEvents,
} from "../authz-denied-events.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAuthzDeniedListParams,
  validateAuthzDeniedSummaryParams,
} from "../protocol/index.js";

function normalizeToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const authzHandlers: GatewayRequestHandlers = {
  "authz.denied.list": ({ respond, params }) => {
    if (!validateAuthzDeniedListParams(params ?? {})) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid authz.denied.list params: ${formatValidationErrors(validateAuthzDeniedListParams.errors)}`,
        ),
      );
      return;
    }
    const raw = (params ?? {}) as {
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
    const page = listGatewayAuthzDenyEventsPage({
      limit: raw.limit,
      cursor: normalizeToken(raw.cursor),
      order: raw.order,
      method: normalizeToken(raw.method),
      reasonCode: normalizeToken(raw.reasonCode),
      errorCode: normalizeToken(raw.errorCode),
      userId: normalizeToken(raw.userId),
      principalId: normalizeToken(raw.principalId),
      actorRole: normalizeToken(raw.actorRole),
      sourceRole: normalizeToken(raw.sourceRole),
      clientId: normalizeToken(raw.clientId),
      clientMode: normalizeToken(raw.clientMode),
      sourceIp: normalizeToken(raw.sourceIp),
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
  "authz.denied.summary": ({ respond, params }) => {
    if (!validateAuthzDeniedSummaryParams(params ?? {})) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid authz.denied.summary params: ${formatValidationErrors(validateAuthzDeniedSummaryParams.errors)}`,
        ),
      );
      return;
    }
    const raw = (params ?? {}) as {
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
    const summary = summarizeGatewayAuthzDenyEvents({
      topN: raw.topN,
      alertThreshold: raw.alertThreshold,
      method: normalizeToken(raw.method),
      reasonCode: normalizeToken(raw.reasonCode),
      errorCode: normalizeToken(raw.errorCode),
      userId: normalizeToken(raw.userId),
      principalId: normalizeToken(raw.principalId),
      actorRole: normalizeToken(raw.actorRole),
      sourceRole: normalizeToken(raw.sourceRole),
      clientId: normalizeToken(raw.clientId),
      clientMode: normalizeToken(raw.clientMode),
      sourceIp: normalizeToken(raw.sourceIp),
      sinceTs: raw.sinceTs,
      untilTs: raw.untilTs,
    });
    respond(
      true,
      {
        ts: Date.now(),
        ...summary,
      },
      undefined,
    );
  },
};
