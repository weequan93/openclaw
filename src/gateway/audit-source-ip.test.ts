import { describe, expect, it } from "vitest";
import { resolveGatewayAuditSourceIp, resolveGatewayRequestSourceIp } from "./audit-source-ip.js";

describe("resolveGatewayAuditSourceIp", () => {
  it("prefers clientIp when present", () => {
    expect(
      resolveGatewayAuditSourceIp({
        clientIp: "203.0.113.7",
        remoteAddr: "127.0.0.1",
      }),
    ).toBe("203.0.113.7");
  });

  it("falls back to remoteAddr when clientIp is missing", () => {
    expect(
      resolveGatewayAuditSourceIp({
        remoteAddr: "127.0.0.1",
      }),
    ).toBe("127.0.0.1");
  });

  it("trims source values", () => {
    expect(
      resolveGatewayAuditSourceIp({
        clientIp: " 203.0.113.8 ",
      }),
    ).toBe("203.0.113.8");
  });

  it("returns null when no usable source ip is available", () => {
    expect(
      resolveGatewayAuditSourceIp({
        clientIp: "   ",
        remoteAddr: "",
      }),
    ).toBeNull();
  });
});

describe("resolveGatewayRequestSourceIp", () => {
  it("returns remote address when request is not from a trusted proxy", () => {
    const req = {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    };

    expect(resolveGatewayRequestSourceIp({ req: req as never })).toBe("127.0.0.1");
  });

  it("uses forwarded client address when request comes from a trusted proxy", () => {
    const req = {
      headers: {
        "x-forwarded-for": "203.0.113.99",
      },
      socket: { remoteAddress: "10.0.0.10" },
    };

    expect(
      resolveGatewayRequestSourceIp({ req: req as never, trustedProxies: ["10.0.0.10"] }),
    ).toBe("203.0.113.99");
  });
});
