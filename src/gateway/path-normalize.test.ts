import { describe, expect, it } from "vitest";
import { normalizeGatewayBoundaryPath } from "./path-normalize.js";

describe("normalizeGatewayBoundaryPath", () => {
  it("normalizes trailing slash and repeated separators", () => {
    expect(normalizeGatewayBoundaryPath("/v1//chat/completions///")).toBe("/v1/chat/completions");
    expect(normalizeGatewayBoundaryPath("/v1\\chat\\completions")).toBe("/v1/chat/completions");
  });

  it("normalizes encoded slash and backslash separators", () => {
    expect(normalizeGatewayBoundaryPath("/v1%2Fchat%2Fcompletions")).toBe("/v1/chat/completions");
    expect(normalizeGatewayBoundaryPath("/v1%5Cchat%5Ccompletions")).toBe("/v1/chat/completions");
  });

  it("normalizes double-encoded separator variants", () => {
    expect(normalizeGatewayBoundaryPath("/v1%252Fchat%252Fcompletions")).toBe(
      "/v1/chat/completions",
    );
    expect(normalizeGatewayBoundaryPath("/v1%255Cchat%255Ccompletions")).toBe(
      "/v1/chat/completions",
    );
  });

  it("normalizes triple-encoded separator variants", () => {
    expect(normalizeGatewayBoundaryPath("/v1%25252Fchat%25252Fcompletions")).toBe(
      "/v1/chat/completions",
    );
    expect(normalizeGatewayBoundaryPath("/v1%25255Cchat%25255Ccompletions")).toBe(
      "/v1/chat/completions",
    );
  });

  it("does not throw on malformed encodings", () => {
    expect(() => normalizeGatewayBoundaryPath("/v1%2")).not.toThrow();
    expect(normalizeGatewayBoundaryPath("/v1%2")).toBe("/v1%2");
  });
});
