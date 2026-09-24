import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();

vi.mock("../request.server", () => ({
  metaApiRequest: (...args: unknown[]) => request(...args),
}));

import { estimateMargin, inspectMarginResponse } from "../margin.server";

const input = {
  symbol: "EURUSD.c",
  type: "ORDER_TYPE_SELL" as const,
  volume: 0.16,
  openPrice: 1.14488,
};

describe("MetaApi margin response", () => {
  beforeEach(() => request.mockReset());

  it("[UNIT] returns a finite numeric broker margin", async () => {
    request.mockResolvedValue({ margin: 257.98 });
    await expect(estimateMargin("account-1", "london", input)).resolves.toBe(257.98);
  });

  it("[UNIT] deliberately accepts an actual numeric zero", async () => {
    request.mockResolvedValue({ margin: 0 });
    await expect(estimateMargin("account-1", "london", input)).resolves.toBe(0);
  });

  it("[UNIT] reports null and zero as distinct response types", () => {
    expect(inspectMarginResponse({ margin: null })).toEqual({
      marginExists: true,
      rawMarginType: "null",
      marginFinite: false,
      marginValue: null,
    });
    expect(inspectMarginResponse({ margin: 0 })).toEqual({
      marginExists: true,
      rawMarginType: "number",
      marginFinite: true,
      marginValue: 0,
    });
  });

  it.each([
    ["null", { margin: null }],
    ["undefined", { margin: undefined }],
    ["missing", {}],
    ["numeric string", { margin: "257.98" }],
    ["NaN", { margin: Number.NaN }],
    ["Infinity", { margin: Number.POSITIVE_INFINITY }],
  ])("[INVARIANT] rejects %s instead of coercing it into broker margin", async (_label, body) => {
    request.mockResolvedValue(body);
    await expect(estimateMargin("account-1", "london", input)).rejects.toMatchObject({
      name: "MetaApiInvalidResponseError",
    });
  });
});
