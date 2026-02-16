import type { GatewayRequestHandlers, GatewayRequestOptions } from "./server-methods/types.js";
import { resolveGatewayAuditSourceIp } from "./audit-source-ip.js";
import { recordGatewayAuthzDenyEvent } from "./authz-denied-events.js";
import { ErrorCodes, errorShape, type ErrorShape } from "./protocol/index.js";
import { auditGatewayAuthorization, authorizeGatewayMethod } from "./server-authz.js";
import { agentHandlers } from "./server-methods/agent.js";
import { agentsHandlers } from "./server-methods/agents.js";
import { authzHandlers } from "./server-methods/authz.js";
import { browserHandlers } from "./server-methods/browser.js";
import { channelsHandlers } from "./server-methods/channels.js";
import { chatHandlers } from "./server-methods/chat.js";
import { configHandlers } from "./server-methods/config.js";
import { connectHandlers } from "./server-methods/connect.js";
import { cronHandlers } from "./server-methods/cron.js";
import { deviceHandlers } from "./server-methods/devices.js";
import { execApprovalsHandlers } from "./server-methods/exec-approvals.js";
import { healthHandlers } from "./server-methods/health.js";
import { logsHandlers } from "./server-methods/logs.js";
import { modelsHandlers } from "./server-methods/models.js";
import { nodeHandlers } from "./server-methods/nodes.js";
import { ownershipHandlers } from "./server-methods/ownership.js";
import { sendHandlers } from "./server-methods/send.js";
import { sessionsHandlers } from "./server-methods/sessions.js";
import { skillsHandlers } from "./server-methods/skills.js";
import { systemHandlers } from "./server-methods/system.js";
import { talkHandlers } from "./server-methods/talk.js";
import { ttsHandlers } from "./server-methods/tts.js";
import { updateHandlers } from "./server-methods/update.js";
import { usageHandlers } from "./server-methods/usage.js";
import { voicewakeHandlers } from "./server-methods/voicewake.js";
import { webHandlers } from "./server-methods/web.js";
import { wizardHandlers } from "./server-methods/wizard.js";

export const coreGatewayHandlers: GatewayRequestHandlers = {
  ...connectHandlers,
  ...logsHandlers,
  ...voicewakeHandlers,
  ...healthHandlers,
  ...channelsHandlers,
  ...chatHandlers,
  ...cronHandlers,
  ...deviceHandlers,
  ...execApprovalsHandlers,
  ...webHandlers,
  ...modelsHandlers,
  ...configHandlers,
  ...wizardHandlers,
  ...talkHandlers,
  ...ttsHandlers,
  ...skillsHandlers,
  ...sessionsHandlers,
  ...systemHandlers,
  ...updateHandlers,
  ...nodeHandlers,
  ...sendHandlers,
  ...usageHandlers,
  ...agentHandlers,
  ...agentsHandlers,
  ...authzHandlers,
  ...browserHandlers,
  ...ownershipHandlers,
};

export async function handleGatewayRequest(
  opts: GatewayRequestOptions & { extraHandlers?: GatewayRequestHandlers },
): Promise<void> {
  const { req, respond, client, isWebchatConnect, context } = opts;
  const authDecision = authorizeGatewayMethod({ method: req.method, client });
  auditGatewayAuthorization({
    logger: context.logGateway,
    method: req.method,
    requestId: req.id,
    decision: authDecision,
    client,
  });
  if (!authDecision.allow) {
    respond(false, undefined, authDecision.error);
    return;
  }
  const handler = opts.extraHandlers?.[req.method] ?? coreGatewayHandlers[req.method];
  if (!handler) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `unknown method: ${req.method}`),
    );
    return;
  }
  const auditRespond = (
    ok: boolean,
    payload?: unknown,
    error?: ErrorShape,
    meta?: Record<string, unknown>,
  ) => {
    respond(ok, payload, error, meta);
    if (ok || !error) {
      return;
    }
    const rawReasonCode =
      error.details && typeof error.details === "object"
        ? (error.details as { reasonCode?: unknown }).reasonCode
        : undefined;
    const reasonCode =
      typeof rawReasonCode === "string" && rawReasonCode.trim().length > 0
        ? rawReasonCode.trim()
        : "POLICY_DENY";
    const owner = authDecision.owner;
    context.logGateway.warn("gateway handler deny", {
      requestId: req.id,
      method: req.method,
      reasonCode,
      errorCode: error.code,
      errorMessage: error.message,
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
    });
    recordGatewayAuthzDenyEvent({
      ts: Date.now(),
      requestId: req.id,
      method: req.method,
      reasonCode,
      errorCode: error.code,
      errorMessage: error.message,
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
    });
  };
  await handler({
    req,
    params: (req.params ?? {}) as Record<string, unknown>,
    client,
    owner: authDecision.owner,
    isWebchatConnect,
    respond: auditRespond,
    context,
  });
}
