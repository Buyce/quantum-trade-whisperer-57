import { describe, expect, it } from "vitest";
import {
  buildClientId,
  CLIENT_ID_MAX_LENGTH,
  CLIENT_ID_RECOGNITION_MAX_LENGTH,
  ClientIdError,
  isPTradesClientId,
  parseClientId,
  PTRADES_STRATEGY_ID,
} from "../client-id";

describe("metaapi clientId", () => {
  it("[UNIT] builds strategy_position_order", () => {
    expect(
      buildClientId({ strategyId: PTRADES_STRATEGY_ID, positionRef: "abc123", orderRef: "1" }),
    ).toBe("PT_abc123_1");
  });

  it("[INVARIANT] never exceeds MetaApi's documented 26-character combined budget", () => {
    const id = buildClientId({
      strategyId: PTRADES_STRATEGY_ID,
      positionRef: "0d4f8a2c-91b7-4c3e-9a11-77ce55aa1234",
      orderRef: "attempt7",
    });
    expect(id.length).toBeLessThanOrEqual(CLIENT_ID_MAX_LENGTH);
    expect(CLIENT_ID_MAX_LENGTH).toBe(26);
    expect(isPTradesClientId(id)).toBe(true);
  });

  it("[INVARIANT] disallowed characters are stripped, not passed through", () => {
    const id = buildClientId({
      strategyId: PTRADES_STRATEGY_ID,
      positionRef: "ab-cd/ef gh",
      orderRef: "1",
    });
    expect(id).toBe("PT_abcdefgh_1");
  });

  it("[INVARIANT] throws rather than emitting an unusable clientId", () => {
    expect(() =>
      buildClientId({ strategyId: PTRADES_STRATEGY_ID, positionRef: "---", orderRef: "1" }),
    ).toThrow(ClientIdError);
    expect(() =>
      buildClientId({
        strategyId: PTRADES_STRATEGY_ID,
        positionRef: "abcdef",
        orderRef: "x".repeat(30),
      }),
    ).toThrow(ClientIdError);
  });

  it("[UNIT] foreign clientIds are not claimed as ours", () => {
    expect(isPTradesClientId("OTHER_abc_1")).toBe(false);
    expect(isPTradesClientId("PT_abc")).toBe(false);
    expect(isPTradesClientId(null)).toBe(false);
    expect(isPTradesClientId(undefined)).toBe(false);
    expect(parseClientId("OTHER_abc_1")).toBeNull();
    expect(parseClientId("PT_abc_9")).toEqual({
      strategyId: "PT",
      positionRef: "abc",
      orderRef: "9",
    });
  });

  it("[INVARIANT] recognises legacy P-Trades ids without emitting new long ids", () => {
    const legacy = `PT_${"a".repeat(23)}_1234`;
    expect(legacy).toHaveLength(CLIENT_ID_RECOGNITION_MAX_LENGTH);
    expect(CLIENT_ID_RECOGNITION_MAX_LENGTH).toBe(31);
    expect(isPTradesClientId(legacy)).toBe(true);
    expect(parseClientId(legacy)).toEqual({
      strategyId: "PT",
      positionRef: "a".repeat(23),
      orderRef: "1234",
    });
    expect(isPTradesClientId(`${legacy}x`)).toBe(false);

    const generated = buildClientId({
      strategyId: PTRADES_STRATEGY_ID,
      positionRef: "a".repeat(50),
      orderRef: "1234",
    });
    expect(generated.length).toBeLessThanOrEqual(CLIENT_ID_MAX_LENGTH);
  });
});
