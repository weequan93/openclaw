import { beforeEach, describe, expect, it, vi } from "vitest";
import { probeGateway } from "./probe.js";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  lastOptions: null as null | Record<string, unknown>,
}));

vi.mock("./client.js", () => ({
  GatewayClient: class {
    private readonly opts: Record<string, unknown>;

    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      mocks.lastOptions = opts;
    }

    async request(method: string, params?: unknown) {
      return await mocks.request(method, params);
    }

    start() {
      void Promise.resolve().then(() => {
        const onHelloOk = this.opts.onHelloOk as ((hello: unknown) => void) | undefined;
        onHelloOk?.({ protocol: 2 });
      });
    }

    stop() {}
  },
}));

describe("probeGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lastOptions = null;
  });

  it("uses read scope for probe clients", async () => {
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "health") {
        return { ok: true };
      }
      if (method === "status") {
        return { status: "ready" };
      }
      if (method === "system-presence") {
        return [];
      }
      if (method === "config.get") {
        return { gateway: { mode: "local" } };
      }
      return null;
    });

    const result = await probeGateway({
      url: "ws://127.0.0.1:18789",
      timeoutMs: 500,
    });

    expect(result.ok).toBe(true);
    expect(result.configSnapshot).toEqual({ gateway: { mode: "local" } });
    expect(mocks.lastOptions?.scopes).toEqual(["operator.read"]);
  });

  it("keeps probe successful when config.get is unauthorized", async () => {
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "health") {
        return { ok: true };
      }
      if (method === "status") {
        return { status: "ready" };
      }
      if (method === "system-presence") {
        return [];
      }
      if (method === "config.get") {
        throw new Error("missing scope: operator.admin");
      }
      return null;
    });

    const result = await probeGateway({
      url: "ws://127.0.0.1:18789",
      timeoutMs: 500,
    });

    expect(result.ok).toBe(true);
    expect(result.health).toEqual({ ok: true });
    expect(result.status).toEqual({ status: "ready" });
    expect(result.configSnapshot).toBeNull();
  });
});
