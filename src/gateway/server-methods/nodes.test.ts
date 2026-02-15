import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "./types.js";
import { nodeHandlers } from "./nodes.js";

const mocks = vi.hoisted(() => ({
  listDevicePairing: vi.fn(),
  listNodePairing: vi.fn(),
  getPairedNode: vi.fn(),
  approveNodePairing: vi.fn(),
  isNodeCommandAllowed: vi.fn(),
  resolveNodeCommandAllowlist: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    loadConfig: mocks.loadConfig,
  };
});

vi.mock("../../infra/device-pairing.js", async () => {
  const actual = await vi.importActual<typeof import("../../infra/device-pairing.js")>(
    "../../infra/device-pairing.js",
  );
  return {
    ...actual,
    listDevicePairing: mocks.listDevicePairing,
  };
});

vi.mock("../../infra/node-pairing.js", async () => {
  const actual = await vi.importActual<typeof import("../../infra/node-pairing.js")>(
    "../../infra/node-pairing.js",
  );
  return {
    ...actual,
    listNodePairing: mocks.listNodePairing,
    getPairedNode: mocks.getPairedNode,
    approveNodePairing: mocks.approveNodePairing,
  };
});

vi.mock("../node-command-policy.js", async () => {
  const actual = await vi.importActual<typeof import("../node-command-policy.js")>(
    "../node-command-policy.js",
  );
  return {
    ...actual,
    isNodeCommandAllowed: mocks.isNodeCommandAllowed,
    resolveNodeCommandAllowlist: mocks.resolveNodeCommandAllowlist,
  };
});

function makeContext(overrides?: Partial<GatewayRequestContext>): GatewayRequestContext & {
  nodeRegistry: {
    listConnected: () => Array<Record<string, unknown>>;
    get: (nodeId: string) => Record<string, unknown> | undefined;
    invoke: (...args: unknown[]) => Promise<Record<string, unknown>>;
  };
} {
  const nodeRegistry = {
    listConnected: vi.fn(() => []),
    get: vi.fn(),
    invoke: vi.fn(),
  };
  return {
    nodeRegistry,
    ...overrides,
  } as unknown as GatewayRequestContext & {
    nodeRegistry: {
      listConnected: () => Array<Record<string, unknown>>;
      get: (nodeId: string) => Record<string, unknown> | undefined;
      invoke: (...args: unknown[]) => Promise<Record<string, unknown>>;
    };
  };
}

describe("node handlers ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("denies node.invoke when non-admin owner does not match node owner", async () => {
    const context = makeContext();
    context.nodeRegistry.get = vi.fn(() => ({
      nodeId: "node-1",
      commands: ["shell.exec"],
    }));
    mocks.getPairedNode.mockResolvedValue({
      nodeId: "node-1",
      token: "token",
      ownerUserId: "user-b",
      createdAtMs: 1,
      approvedAtMs: 2,
    });
    mocks.loadConfig.mockReturnValue({});

    const respond = vi.fn();
    await nodeHandlers["node.invoke"]({
      params: {
        nodeId: "node-1",
        command: "shell.exec",
        idempotencyKey: "idem-1",
      },
      respond,
      context,
      req: { type: "req", id: "1", method: "node.invoke" },
      client: null,
      owner: {
        userId: "user-a",
        principalId: "principal:user-a",
        role: "user",
        sourceRole: "operator",
        scopes: ["operator.write"],
      },
      isWebchatConnect: () => false,
    });

    expect(context.nodeRegistry.invoke).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "node owner mismatch",
      }),
    );
  });

  it("allows node.invoke when delegation rule grants cross-owner access", async () => {
    const context = makeContext();
    context.nodeRegistry.get = vi.fn(() => ({
      nodeId: "node-1",
      commands: ["shell.exec"],
    }));
    context.nodeRegistry.invoke = vi.fn(async () => ({
      ok: true,
      payload: { done: true },
      payloadJSON: null,
    }));
    mocks.getPairedNode.mockResolvedValue({
      nodeId: "node-1",
      token: "token",
      ownerUserId: "user-b",
      createdAtMs: 1,
      approvedAtMs: 2,
    });
    mocks.loadConfig.mockReturnValue({
      gateway: {
        multiUser: {
          mode: "strict",
          delegation: {
            enabled: true,
            rules: [
              {
                fromUserId: "user-a",
                toUserId: "user-b",
                resources: ["nodes"],
              },
            ],
          },
        },
      },
    });
    mocks.resolveNodeCommandAllowlist.mockReturnValue([]);
    mocks.isNodeCommandAllowed.mockReturnValue({ ok: true });

    const respond = vi.fn();
    await nodeHandlers["node.invoke"]({
      params: {
        nodeId: "node-1",
        command: "shell.exec",
        idempotencyKey: "idem-delegated",
      },
      respond,
      context,
      req: { type: "req", id: "1", method: "node.invoke" },
      client: null,
      owner: {
        userId: "user-a",
        principalId: "principal:user-a",
        role: "user",
        sourceRole: "operator",
        scopes: ["operator.write"],
      },
      isWebchatConnect: () => false,
    });

    expect(context.nodeRegistry.invoke).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        nodeId: "node-1",
      }),
      undefined,
    );
  });

  it("allows node.invoke for admin even when node owner differs", async () => {
    const context = makeContext();
    context.nodeRegistry.get = vi.fn(() => ({
      nodeId: "node-1",
      commands: ["shell.exec"],
    }));
    context.nodeRegistry.invoke = vi.fn(async () => ({
      ok: true,
      payload: { done: true },
      payloadJSON: null,
    }));
    mocks.getPairedNode.mockResolvedValue({
      nodeId: "node-1",
      token: "token",
      ownerUserId: "user-b",
      createdAtMs: 1,
      approvedAtMs: 2,
    });
    mocks.loadConfig.mockReturnValue({});
    mocks.resolveNodeCommandAllowlist.mockReturnValue([]);
    mocks.isNodeCommandAllowed.mockReturnValue({ ok: true });

    const respond = vi.fn();
    await nodeHandlers["node.invoke"]({
      params: {
        nodeId: "node-1",
        command: "shell.exec",
        idempotencyKey: "idem-2",
      },
      respond,
      context,
      req: { type: "req", id: "1", method: "node.invoke" },
      client: null,
      owner: {
        userId: "admin-a",
        principalId: "principal:admin-a",
        role: "admin",
        sourceRole: "operator",
        scopes: ["operator.admin"],
      },
      isWebchatConnect: () => false,
    });

    expect(context.nodeRegistry.invoke).toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        nodeId: "node-1",
      }),
      undefined,
    );
  });

  it("filters node.list to caller-owned nodes for non-admin users", async () => {
    const context = makeContext();
    context.nodeRegistry.listConnected = vi.fn(() => [
      {
        nodeId: "node-1",
        displayName: "Node A",
        commands: [],
        caps: [],
      },
      {
        nodeId: "node-2",
        displayName: "Node B",
        commands: [],
        caps: [],
      },
    ]);
    mocks.listDevicePairing.mockResolvedValue({
      pending: [],
      paired: [
        {
          deviceId: "node-1",
          role: "node",
          displayName: "Node A",
        },
        {
          deviceId: "node-2",
          role: "node",
          displayName: "Node B",
        },
      ],
    });
    mocks.listNodePairing.mockResolvedValue({
      pending: [],
      paired: [
        {
          nodeId: "node-1",
          token: "token-1",
          ownerUserId: "user-a",
          createdAtMs: 1,
          approvedAtMs: 2,
        },
        {
          nodeId: "node-2",
          token: "token-2",
          ownerUserId: "user-b",
          createdAtMs: 1,
          approvedAtMs: 2,
        },
      ],
    });

    const respond = vi.fn();
    await nodeHandlers["node.list"]({
      params: {},
      respond,
      context,
      req: { type: "req", id: "1", method: "node.list" },
      client: null,
      owner: {
        userId: "user-a",
        principalId: "principal:user-a",
        role: "user",
        sourceRole: "operator",
        scopes: ["operator.read"],
      },
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        nodes: [expect.objectContaining({ nodeId: "node-1" })],
      }),
      undefined,
    );
  });

  it("passes ownerUserId override when approving node pairing", async () => {
    const context = makeContext({
      broadcast: vi.fn(),
    });
    mocks.approveNodePairing.mockResolvedValue({
      requestId: "req-1",
      node: {
        nodeId: "node-1",
        token: "token-1",
        ownerUserId: "user-a",
        createdAtMs: 1,
        approvedAtMs: 2,
      },
    });

    const respond = vi.fn();
    await nodeHandlers["node.pair.approve"]({
      params: { requestId: "req-1", ownerUserId: "user-a" },
      respond,
      context,
      req: { type: "req", id: "1", method: "node.pair.approve" },
      client: null,
      owner: {
        userId: "admin-a",
        principalId: "principal:admin-a",
        role: "admin",
        sourceRole: "operator",
        scopes: ["operator.admin"],
      },
      isWebchatConnect: () => false,
    });

    expect(mocks.approveNodePairing).toHaveBeenCalledWith("req-1", { ownerUserId: "user-a" });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        requestId: "req-1",
      }),
      undefined,
    );
  });

  it("requires ownerUserId when approving pairing in strict mode", async () => {
    const context = makeContext({
      broadcast: vi.fn(),
    });
    mocks.loadConfig.mockReturnValue({
      gateway: { multiUser: { mode: "strict" } },
    });

    const respond = vi.fn();
    await nodeHandlers["node.pair.approve"]({
      params: { requestId: "req-1" },
      respond,
      context,
      req: { type: "req", id: "1", method: "node.pair.approve" },
      client: null,
      owner: {
        userId: "admin-a",
        principalId: "principal:admin-a",
        role: "admin",
        sourceRole: "operator",
        scopes: ["operator.admin"],
      },
      isWebchatConnect: () => false,
    });

    expect(mocks.approveNodePairing).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("ownerUserId required"),
      }),
    );
  });

  it("includes unowned nodes in compat mode for non-admin users", async () => {
    const context = makeContext();
    context.nodeRegistry.listConnected = vi.fn(() => [
      {
        nodeId: "node-legacy",
        displayName: "Legacy Node",
        commands: [],
        caps: [],
      },
    ]);
    mocks.listDevicePairing.mockResolvedValue({
      pending: [],
      paired: [
        {
          deviceId: "node-legacy",
          role: "node",
          displayName: "Legacy Node",
        },
      ],
    });
    mocks.listNodePairing.mockResolvedValue({
      pending: [],
      paired: [
        {
          nodeId: "node-legacy",
          token: "token-legacy",
          createdAtMs: 1,
          approvedAtMs: 2,
        },
      ],
    });
    mocks.loadConfig.mockReturnValue({
      gateway: { multiUser: { mode: "compat" } },
    });

    const respond = vi.fn();
    await nodeHandlers["node.list"]({
      params: {},
      respond,
      context,
      req: { type: "req", id: "1", method: "node.list" },
      client: null,
      owner: {
        userId: "user-a",
        principalId: "principal:user-a",
        role: "user",
        sourceRole: "operator",
        scopes: ["operator.read"],
      },
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        nodes: [expect.objectContaining({ nodeId: "node-legacy" })],
      }),
      undefined,
    );
  });
});
