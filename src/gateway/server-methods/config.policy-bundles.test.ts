import { describe, expect, it, vi } from "vitest";
import { configHandlers } from "./config.js";

describe("config policy bundle handlers", () => {
  it("lists available bundles", async () => {
    const respond = vi.fn();
    await configHandlers["config.policyBundles.list"]({
      respond,
      params: {},
    } as unknown as Parameters<(typeof configHandlers)["config.policyBundles.list"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        bundles: expect.arrayContaining([
          expect.objectContaining({ id: "single_user" }),
          expect.objectContaining({ id: "multi_user_isolated" }),
          expect.objectContaining({ id: "strict_admin_control" }),
        ]),
      }),
      undefined,
    );
  });

  it("resolves a policy bundle by id", async () => {
    const respond = vi.fn();
    await configHandlers["config.policyBundle.resolve"]({
      respond,
      params: { bundleId: "strict_admin_control" },
    } as unknown as Parameters<(typeof configHandlers)["config.policyBundle.resolve"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        bundle: expect.objectContaining({
          id: "strict_admin_control",
        }),
      }),
      undefined,
    );
  });

  it("rejects invalid policy bundle params", async () => {
    const respond = vi.fn();
    await configHandlers["config.policyBundle.resolve"]({
      respond,
      params: { bundleId: "missing" },
    } as unknown as Parameters<(typeof configHandlers)["config.policyBundle.resolve"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("invalid config.policyBundle.resolve params"),
      }),
    );
  });

  it("rejects invalid policy bundle apply params", async () => {
    const respond = vi.fn();
    await configHandlers["config.policyBundle.apply"]({
      respond,
      params: {},
    } as unknown as Parameters<(typeof configHandlers)["config.policyBundle.apply"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("invalid config.policyBundle.apply params"),
      }),
    );
  });
});
