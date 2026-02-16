export const OPERATOR_ADMIN_SCOPE = "operator.admin";
export const OPERATOR_READ_SCOPE = "operator.read";
export const OPERATOR_WRITE_SCOPE = "operator.write";
export const OPERATOR_APPROVALS_SCOPE = "operator.approvals";
export const OPERATOR_PAIRING_SCOPE = "operator.pairing";

export type GatewayMethodAccessClass =
  | "node-role"
  | "approval"
  | "pairing"
  | "read"
  | "write"
  | "admin";

const APPROVAL_METHODS = new Set(["exec.approval.request", "exec.approval.resolve"]);
const NODE_ROLE_METHODS = new Set(["node.invoke.result", "node.event", "skills.bins"]);
const PAIRING_METHODS = new Set([
  "node.pair.request",
  "node.pair.list",
  "node.pair.approve",
  "node.pair.reject",
  "node.pair.verify",
  "device.pair.list",
  "device.pair.approve",
  "device.pair.reject",
  "device.token.rotate",
  "device.token.revoke",
  "node.rename",
]);
const ADMIN_METHOD_PREFIXES = ["exec.approvals."];
const READ_METHODS = new Set([
  "health",
  "channels.status",
  "usage.status",
  "usage.cost",
  "tts.status",
  "tts.providers",
  "models.list",
  "agents.list",
  "agent.identity.get",
  "skills.status",
  "voicewake.get",
  "sessions.list",
  "sessions.preview",
  "sessions.resolve",
  "node.list",
  "node.describe",
  "chat.history",
]);
const WRITE_METHODS = new Set([
  "send",
  "agent",
  "agent.wait",
  "tts.convert",
  "node.invoke",
  "chat.send",
  "chat.abort",
  "browser.request",
  "sessions.patch",
  "sessions.reset",
  "sessions.delete",
  "sessions.compact",
]);

export function isGatewayAdminOnlyMethod(method: string): boolean {
  return (
    method.startsWith("config.") ||
    method.startsWith("wizard.") ||
    method.startsWith("update.") ||
    method.startsWith("cron.") ||
    method === "status" ||
    method === "system-presence" ||
    method === "last-heartbeat" ||
    method === "logs.tail" ||
    method === "channels.logout" ||
    method === "authz.allow.list" ||
    method === "authz.allow.summary" ||
    method === "authz.denied.list" ||
    method === "authz.denied.summary" ||
    method === "ownership.gaps" ||
    method === "ownership.backfill" ||
    method === "agents.create" ||
    method === "agents.update" ||
    method === "agents.delete" ||
    method === "agents.files.list" ||
    method === "agents.files.get" ||
    method === "agents.files.set" ||
    method === "skills.install" ||
    method === "skills.update" ||
    method === "tts.enable" ||
    method === "tts.disable" ||
    method === "tts.setProvider" ||
    method === "voicewake.set" ||
    method === "talk.mode" ||
    method === "wake" ||
    method === "set-heartbeats" ||
    method === "system-event"
  );
}

export function isGatewayMethodExplicitlyClassified(method: string): boolean {
  return (
    NODE_ROLE_METHODS.has(method) ||
    APPROVAL_METHODS.has(method) ||
    PAIRING_METHODS.has(method) ||
    READ_METHODS.has(method) ||
    WRITE_METHODS.has(method) ||
    ADMIN_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix)) ||
    isGatewayAdminOnlyMethod(method)
  );
}

export function classifyGatewayMethodAccess(method: string): GatewayMethodAccessClass {
  if (NODE_ROLE_METHODS.has(method)) {
    return "node-role";
  }
  if (APPROVAL_METHODS.has(method)) {
    return "approval";
  }
  if (PAIRING_METHODS.has(method)) {
    return "pairing";
  }
  if (READ_METHODS.has(method)) {
    return "read";
  }
  if (WRITE_METHODS.has(method)) {
    return "write";
  }
  if (
    ADMIN_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix)) ||
    isGatewayAdminOnlyMethod(method)
  ) {
    return "admin";
  }
  return "admin";
}

export function resolveGatewayOperatorScopesForMethod(method: string): string[] {
  switch (classifyGatewayMethodAccess(method)) {
    case "approval":
      return [OPERATOR_APPROVALS_SCOPE];
    case "pairing":
      return [OPERATOR_PAIRING_SCOPE];
    case "read":
      return [OPERATOR_READ_SCOPE];
    case "write":
      return [OPERATOR_WRITE_SCOPE];
    default:
      return [OPERATOR_ADMIN_SCOPE];
  }
}
