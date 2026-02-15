import { beforeEach, describe, expect, it, vi } from "vitest";
import { callGatewayTool, resolveGatewayOptions } from "./gateway.js";

const callGatewayMock = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (...args: unknown[]) => callGatewayMock(...args),
}));

describe("gateway tool defaults", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
  });

  it("leaves url undefined so callGateway can use config", () => {
    const opts = resolveGatewayOptions();
    expect(opts.url).toBeUndefined();
  });

  it("passes through explicit overrides", async () => {
    callGatewayMock.mockResolvedValueOnce({ ok: true });
    await callGatewayTool(
      "health",
      { gatewayUrl: "ws://example", gatewayToken: "t", timeoutMs: 5000 },
      {},
    );
    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "ws://example",
        token: "t",
        timeoutMs: 5000,
      }),
    );
  });

  it("blocks admin-scope methods by default", async () => {
    await expect(callGatewayTool("config.get", {}, {})).rejects.toThrow("requires admin scope");
    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it("allows admin-scope methods with explicit opt-in", async () => {
    callGatewayMock.mockResolvedValueOnce({ ok: true });
    await callGatewayTool("config.get", {}, {}, { allowAdmin: true });
    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "config.get",
        scopes: ["operator.admin"],
      }),
    );
  });

  it("treats wake as admin-scoped", async () => {
    await expect(callGatewayTool("wake", {}, { mode: "now", text: "wake up" })).rejects.toThrow(
      "requires admin scope",
    );

    callGatewayMock.mockResolvedValueOnce({ ok: true });
    await callGatewayTool("wake", {}, { mode: "next-heartbeat", text: "wake up" }, {
      allowAdmin: true,
    });
    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "wake",
        scopes: ["operator.admin"],
      }),
    );
  });

  it("uses least-privilege method scopes for non-admin calls", async () => {
    callGatewayMock.mockResolvedValueOnce({ ok: true });
    await callGatewayTool("node.invoke", {}, {});
    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "node.invoke",
        scopes: ["operator.write"],
      }),
    );
  });

  it("preserves explicit scope overrides", async () => {
    callGatewayMock.mockResolvedValueOnce({ ok: true });
    await callGatewayTool(
      "health",
      {},
      {},
      {
        scopes: ["operator.read", "operator.write", "operator.read"],
      },
    );
    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "health",
        scopes: ["operator.read", "operator.write"],
      }),
    );
  });

  it("passes owner identity through when provided", async () => {
    callGatewayMock.mockResolvedValueOnce({ ok: true });
    await callGatewayTool(
      "health",
      {
        ownerUserId: "user-1",
        ownerPrincipalId: "principal:user-1",
        ownerAlias: "alice",
      },
      {},
    );
    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: {
          userId: "user-1",
          principalId: "principal:user-1",
          alias: "alice",
        },
      }),
    );
  });

  it("derives principal id when owner principal is missing", async () => {
    callGatewayMock.mockResolvedValueOnce({ ok: true });
    await callGatewayTool("health", { ownerUserId: "user-2" }, {});
    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: {
          userId: "user-2",
          principalId: "user:user-2",
        },
      }),
    );
  });
});
