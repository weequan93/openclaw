import { beforeEach, describe, expect, it, vi } from "vitest";

const backfillGatewayOwnership = vi.fn();
const listGatewayOwnershipGaps = vi.fn();

vi.mock("../ownership-backfill.js", () => ({
  backfillGatewayOwnership: (params: unknown) => backfillGatewayOwnership(params),
  listGatewayOwnershipGaps: (params: unknown) => listGatewayOwnershipGaps(params),
}));

import { ownershipHandlers } from "./ownership.js";

describe("ownership handlers", () => {
  beforeEach(() => {
    backfillGatewayOwnership.mockReset();
    listGatewayOwnershipGaps.mockReset();
  });

  it("lists ownership gaps with validated params", async () => {
    listGatewayOwnershipGaps.mockResolvedValueOnce({ ok: true, ts: 1 });
    const respond = vi.fn();
    await ownershipHandlers["ownership.gaps"]({
      params: {
        limit: 25,
        resources: ["sessions", "nodes"],
      },
      respond,
    } as unknown as Parameters<(typeof ownershipHandlers)["ownership.gaps"]>[0]);
    expect(listGatewayOwnershipGaps).toHaveBeenCalledWith({
      limit: 25,
      resources: ["sessions", "nodes"],
    });
    expect(respond).toHaveBeenCalledWith(true, { ok: true, ts: 1 }, undefined);
  });

  it("rejects invalid ownership.gaps params", async () => {
    const respond = vi.fn();
    await ownershipHandlers["ownership.gaps"]({
      params: {
        limit: 0,
      },
      respond,
    } as unknown as Parameters<(typeof ownershipHandlers)["ownership.gaps"]>[0]);
    expect(listGatewayOwnershipGaps).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("invalid ownership.gaps params"),
      }),
    );
  });

  it("returns unavailable when ownership.gaps throws", async () => {
    listGatewayOwnershipGaps.mockRejectedValueOnce(new Error("boom-gaps"));
    const respond = vi.fn();
    await ownershipHandlers["ownership.gaps"]({
      params: {
        limit: 5,
      },
      respond,
    } as unknown as Parameters<(typeof ownershipHandlers)["ownership.gaps"]>[0]);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "UNAVAILABLE",
        message: expect.stringContaining("boom-gaps"),
      }),
    );
  });

  it("runs ownership backfill with validated params", async () => {
    backfillGatewayOwnership.mockResolvedValueOnce({ ok: true, ts: 1 });
    const respond = vi.fn();
    await ownershipHandlers["ownership.backfill"]({
      params: {
        ownerUserId: "42c1104f-6e92-46e2-8fbb-8918ecec9346",
        ownerPrincipalId: "principal:admin",
        dryRun: true,
        resources: ["sessions"],
      },
      respond,
    } as unknown as Parameters<(typeof ownershipHandlers)["ownership.backfill"]>[0]);
    expect(backfillGatewayOwnership).toHaveBeenCalledWith({
      ownerUserId: "42c1104f-6e92-46e2-8fbb-8918ecec9346",
      ownerPrincipalId: "principal:admin",
      dryRun: true,
      resources: ["sessions"],
    });
    expect(respond).toHaveBeenCalledWith(true, { ok: true, ts: 1 }, undefined);
  });

  it("rejects invalid params", async () => {
    const respond = vi.fn();
    await ownershipHandlers["ownership.backfill"]({
      params: {
        ownerUserId: "",
      },
      respond,
    } as unknown as Parameters<(typeof ownershipHandlers)["ownership.backfill"]>[0]);
    expect(backfillGatewayOwnership).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("invalid ownership.backfill params"),
      }),
    );
  });

  it("returns unavailable when backfill throws", async () => {
    backfillGatewayOwnership.mockRejectedValueOnce(new Error("boom"));
    const respond = vi.fn();
    await ownershipHandlers["ownership.backfill"]({
      params: {
        ownerUserId: "4f2dd9f0-7f5d-44a0-8c13-cea43e6f4741",
      },
      respond,
    } as unknown as Parameters<(typeof ownershipHandlers)["ownership.backfill"]>[0]);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "UNAVAILABLE",
        message: expect.stringContaining("boom"),
      }),
    );
  });
});
