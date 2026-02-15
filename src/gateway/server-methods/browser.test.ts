import { describe, expect, it, vi } from "vitest";
import type { NodeSession } from "../node-registry.js";
import type { GatewayRequestContext } from "./types.js";
import { browserHandlers } from "./browser.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  startBrowserControlServiceFromConfig: vi.fn(async () => true),
  createBrowserControlContext: vi.fn(() => ({})),
  dispatch: vi.fn(async () => ({ status: 200, body: { ok: true } })),
  getPairedNode: vi.fn(async () => null),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../../browser/control-service.js", () => ({
  startBrowserControlServiceFromConfig: mocks.startBrowserControlServiceFromConfig,
  createBrowserControlContext: mocks.createBrowserControlContext,
}));

vi.mock("../../browser/routes/dispatcher.js", () => ({
  createBrowserRouteDispatcher: () => ({
    dispatch: mocks.dispatch,
  }),
}));

vi.mock("../../infra/node-pairing.js", () => ({
  getPairedNode: mocks.getPairedNode,
}));

function createBrowserNode(nodeId: string): NodeSession {
  return {
    nodeId,
    connId: `conn-${nodeId}`,
    client: {} as never,
    caps: ["browser"],
    commands: ["browser.proxy"],
    connectedAtMs: Date.now(),
  };
}

const makeContext = (params?: {
  nodes?: NodeSession[];
  invoke?: (args: unknown) => Promise<unknown>;
}): GatewayRequestContext =>
  ({
    nodeRegistry: {
      listConnected: () => params?.nodes ?? [],
      invoke: params?.invoke ?? (async () => ({ ok: false, error: { message: "not implemented" } })),
    },
  }) as unknown as GatewayRequestContext;

const userOwner = {
  userId: "user-1",
  principalId: "msg:telegram:1",
  role: "user" as const,
  sourceRole: "operator" as const,
  scopes: ["operator.write"],
};

describe("gateway browser.request ownership policy", () => {
  it("denies non-admin profile configuration routes", async () => {
    mocks.loadConfig.mockReturnValue({
      browser: {
        defaultProfile: "alice",
        profiles: {
          alice: { cdpPort: 18810, color: "#00AA00", ownerUserId: "user-1" },
        },
      },
    });

    const respond = vi.fn();
    await browserHandlers["browser.request"]({
      req: { type: "req", id: "1", method: "browser.request" },
      params: { method: "GET", path: "/profiles" },
      respond,
      context: makeContext(),
      client: null,
      owner: userOwner,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalled();
    const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
    expect(ok).toBe(false);
    expect(payload).toBeUndefined();
    expect(error?.message).toContain("admin-only");
  });

  it("injects default owned profile for non-admin browser requests", async () => {
    mocks.loadConfig.mockReturnValue({
      browser: {
        defaultProfile: "alice",
        profiles: {
          alice: { cdpPort: 18810, color: "#00AA00", ownerUserId: "user-1" },
        },
      },
    });
    mocks.dispatch.mockClear();
    const respond = vi.fn();

    await browserHandlers["browser.request"]({
      req: { type: "req", id: "2", method: "browser.request" },
      params: { method: "GET", path: "/tabs", query: {} },
      respond,
      context: makeContext(),
      client: null,
      owner: userOwner,
      isWebchatConnect: () => false,
    });

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/tabs",
        query: expect.objectContaining({ profile: "alice" }),
      }),
    );
    expect(respond).toHaveBeenCalledWith(true, { ok: true });
  });

  it("denies browser proxy when node owner is missing in strict mode", async () => {
    const node = createBrowserNode("node-strict");
    mocks.loadConfig.mockReturnValue({
      gateway: { multiUser: { mode: "strict" } },
      browser: {
        defaultProfile: "alice",
        profiles: {
          alice: { cdpPort: 18810, color: "#00AA00", ownerUserId: "user-1" },
        },
      },
    });
    mocks.getPairedNode.mockResolvedValueOnce(null);
    const invoke = vi.fn(async () => ({ ok: true, payload: { result: { ok: true } } }));
    const respond = vi.fn();

    await browserHandlers["browser.request"]({
      req: { type: "req", id: "3", method: "browser.request" },
      params: { method: "GET", path: "/tabs", query: { profile: "alice" } },
      respond,
      context: makeContext({ nodes: [node], invoke }),
      client: null,
      owner: userOwner,
      isWebchatConnect: () => false,
    });

    const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
    expect(ok).toBe(false);
    expect(payload).toBeUndefined();
    expect(error?.message).toContain("browser node owner mismatch");
    expect((error?.details as { reasonCode?: string } | undefined)?.reasonCode).toBe(
      "OWNER_MISMATCH",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("allows browser proxy when browser delegation grants cross-owner access", async () => {
    const node = createBrowserNode("node-delegated");
    mocks.loadConfig.mockReturnValue({
      gateway: {
        multiUser: {
          mode: "strict",
          delegation: {
            enabled: true,
            rules: [
              {
                fromUserId: "user-1",
                toUserId: "user-2",
                resources: ["browser"],
              },
            ],
          },
        },
      },
      browser: {
        defaultProfile: "bob",
        profiles: {
          alice: { cdpPort: 18810, color: "#00AA00", ownerUserId: "user-1" },
          bob: { cdpPort: 18811, color: "#0000AA", ownerUserId: "user-2" },
        },
      },
    });
    mocks.getPairedNode.mockResolvedValueOnce({ ownerUserId: "user-2" });
    const invoke = vi.fn(async () => ({ ok: true, payload: { result: { source: "delegated" } } }));
    const respond = vi.fn();

    await browserHandlers["browser.request"]({
      req: { type: "req", id: "3b", method: "browser.request" },
      params: { method: "GET", path: "/tabs", query: { profile: "bob" } },
      respond,
      context: makeContext({ nodes: [node], invoke }),
      client: null,
      owner: userOwner,
      isWebchatConnect: () => false,
    });

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: "node-delegated",
        command: "browser.proxy",
      }),
    );
    expect(respond).toHaveBeenCalledWith(true, { source: "delegated" });
  });

  it("denies browser proxy when profile owner and node owner do not match", async () => {
    const node = createBrowserNode("node-profile-mismatch");
    mocks.loadConfig.mockReturnValue({
      gateway: {
        multiUser: {
          mode: "strict",
          delegation: {
            enabled: true,
            rules: [
              {
                fromUserId: "user-1",
                toUserId: "user-2",
                resources: ["browser"],
              },
            ],
          },
        },
      },
      browser: {
        defaultProfile: "alice",
        profiles: {
          alice: { cdpPort: 18810, color: "#00AA00", ownerUserId: "user-1" },
        },
      },
    });
    mocks.getPairedNode.mockResolvedValueOnce({ ownerUserId: "user-2" });
    const invoke = vi.fn(async () => ({ ok: true, payload: { result: { source: "node" } } }));
    const respond = vi.fn();

    await browserHandlers["browser.request"]({
      req: { type: "req", id: "3c", method: "browser.request" },
      params: { method: "GET", path: "/tabs", query: { profile: "alice" } },
      respond,
      context: makeContext({ nodes: [node], invoke }),
      client: null,
      owner: userOwner,
      isWebchatConnect: () => false,
    });

    const [ok, payload, error] = respond.mock.calls.at(-1) ?? [];
    expect(ok).toBe(false);
    expect(payload).toBeUndefined();
    expect(error?.message).toContain("profile/node owner mismatch");
    expect((error?.details as { reasonCode?: string } | undefined)?.reasonCode).toBe(
      "OWNER_MISMATCH",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("allows browser proxy when node owner matches in strict mode", async () => {
    const node = createBrowserNode("node-owned");
    mocks.loadConfig.mockReturnValue({
      gateway: { multiUser: { mode: "strict" } },
      browser: {
        defaultProfile: "alice",
        profiles: {
          alice: { cdpPort: 18810, color: "#00AA00", ownerUserId: "user-1" },
        },
      },
    });
    mocks.getPairedNode.mockResolvedValueOnce({ ownerUserId: "user-1" });
    const invoke = vi.fn(async () => ({ ok: true, payload: { result: { source: "node" } } }));
    const respond = vi.fn();

    await browserHandlers["browser.request"]({
      req: { type: "req", id: "4", method: "browser.request" },
      params: { method: "GET", path: "/tabs", query: { profile: "alice" } },
      respond,
      context: makeContext({ nodes: [node], invoke }),
      client: null,
      owner: userOwner,
      isWebchatConnect: () => false,
    });

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: "node-owned",
        command: "browser.proxy",
      }),
    );
    expect(respond).toHaveBeenCalledWith(true, { source: "node" });
  });

  it("allows browser proxy with missing node owner in compat mode", async () => {
    const node = createBrowserNode("node-compat");
    mocks.loadConfig.mockReturnValue({
      gateway: { multiUser: { mode: "compat" } },
      browser: {
        defaultProfile: "alice",
        profiles: {
          alice: { cdpPort: 18810, color: "#00AA00", ownerUserId: "user-1" },
        },
      },
    });
    mocks.getPairedNode.mockResolvedValueOnce(null);
    const invoke = vi.fn(async () => ({ ok: true, payload: { result: { mode: "compat" } } }));
    const respond = vi.fn();

    await browserHandlers["browser.request"]({
      req: { type: "req", id: "5", method: "browser.request" },
      params: { method: "GET", path: "/tabs", query: { profile: "alice" } },
      respond,
      context: makeContext({ nodes: [node], invoke }),
      client: null,
      owner: userOwner,
      isWebchatConnect: () => false,
    });

    expect(invoke).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(true, { mode: "compat" });
  });
});
