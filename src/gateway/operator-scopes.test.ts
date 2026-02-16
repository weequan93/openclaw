import { describe, expect, it } from "vitest";
import {
  classifyGatewayMethodAccess,
  isGatewayMethodExplicitlyClassified,
  resolveGatewayOperatorScopesForMethod,
} from "./operator-scopes.js";
import { GATEWAY_BASE_METHODS } from "./server-methods-list.js";

describe("gateway operator scope resolution", () => {
  it("classifies read methods", () => {
    expect(classifyGatewayMethodAccess("health")).toBe("read");
    expect(resolveGatewayOperatorScopesForMethod("health")).toEqual(["operator.read"]);
    expect(classifyGatewayMethodAccess("sessions.resolve")).toBe("read");
    expect(resolveGatewayOperatorScopesForMethod("sessions.resolve")).toEqual(["operator.read"]);
  });

  it("classifies write methods", () => {
    expect(classifyGatewayMethodAccess("send")).toBe("write");
    expect(resolveGatewayOperatorScopesForMethod("send")).toEqual(["operator.write"]);
    expect(classifyGatewayMethodAccess("sessions.patch")).toBe("write");
    expect(resolveGatewayOperatorScopesForMethod("sessions.patch")).toEqual(["operator.write"]);
    expect(classifyGatewayMethodAccess("sessions.reset")).toBe("write");
    expect(resolveGatewayOperatorScopesForMethod("sessions.reset")).toEqual(["operator.write"]);
    expect(classifyGatewayMethodAccess("sessions.delete")).toBe("write");
    expect(resolveGatewayOperatorScopesForMethod("sessions.delete")).toEqual(["operator.write"]);
    expect(classifyGatewayMethodAccess("sessions.compact")).toBe("write");
    expect(resolveGatewayOperatorScopesForMethod("sessions.compact")).toEqual(["operator.write"]);
  });

  it("classifies pairing methods", () => {
    expect(classifyGatewayMethodAccess("node.pair.approve")).toBe("pairing");
    expect(resolveGatewayOperatorScopesForMethod("node.pair.approve")).toEqual([
      "operator.pairing",
    ]);
    const pairingMethods = [
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
    ] as const;
    for (const method of pairingMethods) {
      expect(classifyGatewayMethodAccess(method)).toBe("pairing");
      expect(resolveGatewayOperatorScopesForMethod(method)).toEqual(["operator.pairing"]);
    }
  });

  it("classifies approval methods", () => {
    expect(classifyGatewayMethodAccess("exec.approval.resolve")).toBe("approval");
    expect(resolveGatewayOperatorScopesForMethod("exec.approval.resolve")).toEqual([
      "operator.approvals",
    ]);
  });

  it("falls back to admin for control-plane methods", () => {
    expect(classifyGatewayMethodAccess("config.apply")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("config.apply")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("config.policyBundles.list")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("config.policyBundles.list")).toEqual([
      "operator.admin",
    ]);
    expect(classifyGatewayMethodAccess("config.policyBundle.resolve")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("config.policyBundle.resolve")).toEqual([
      "operator.admin",
    ]);
    expect(classifyGatewayMethodAccess("config.policyBundle.apply")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("config.policyBundle.apply")).toEqual([
      "operator.admin",
    ]);
    expect(classifyGatewayMethodAccess("config.changes.list")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("config.changes.list")).toEqual([
      "operator.admin",
    ]);
  });

  it("classifies ownership/admin audit methods as admin-only", () => {
    expect(classifyGatewayMethodAccess("status")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("status")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("system-presence")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("system-presence")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("last-heartbeat")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("last-heartbeat")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("cron.list")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("cron.list")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("cron.status")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("cron.status")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("cron.runs")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("cron.runs")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("authz.allow.list")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("authz.allow.list")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("authz.allow.summary")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("authz.allow.summary")).toEqual([
      "operator.admin",
    ]);
    expect(classifyGatewayMethodAccess("authz.denied.list")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("authz.denied.list")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("authz.denied.summary")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("authz.denied.summary")).toEqual([
      "operator.admin",
    ]);
    expect(classifyGatewayMethodAccess("ownership.gaps")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("ownership.gaps")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("ownership.backfill")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("ownership.backfill")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("voicewake.set")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("voicewake.set")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("tts.enable")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("tts.enable")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("tts.disable")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("tts.disable")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("tts.setProvider")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("tts.setProvider")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("talk.mode")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("talk.mode")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("wake")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("wake")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("set-heartbeats")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("set-heartbeats")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("system-event")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("system-event")).toEqual(["operator.admin"]);
    expect(classifyGatewayMethodAccess("channels.logout")).toBe("admin");
    expect(resolveGatewayOperatorScopesForMethod("channels.logout")).toEqual(["operator.admin"]);
  });

  it("explicitly classifies every core gateway method", () => {
    for (const method of GATEWAY_BASE_METHODS) {
      expect(isGatewayMethodExplicitlyClassified(method)).toBe(true);
    }
  });
});
