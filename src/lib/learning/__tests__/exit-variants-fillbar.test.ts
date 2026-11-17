import { describe, expect, it } from "vitest";
import { clearUndecisiveFillBar, summariseVariants } from "../exit-variants.server";

const amb = { t: "2026-11-17T13:00:00.000Z", hR: null, lR: null, amb: true };
const b = (t: string, hR: number, lR: number) => ({ t, hR, lR, amb: false });
// Real shape from production row (2026-11-17): fill bar ambiguous, then clear bars.
const path = {
  bars: [amb, b("2026-11-17T13:15:00.000Z", 1.3034, -0.5618), b("2026-11-17T13:30:00.000Z", 2.9775, -0.9101)],
  targetsR: [0.6517, 1.0899, null],
  truncated: false,
};

describe("exit-variant fill bar handling", () => {
  it("[INVARIANT] drops the leading fill bar only when the replay recorded no ambiguous touch", () => {
    const row = { detected_at: "2026-11-17T12:50:00Z", instrument: "XAUUSD", post_entry_path: path, ambiguous_bars: 0 };
    const out = clearUndecisiveFillBar(row).post_entry_path as typeof path;
    expect(out.bars).toHaveLength(2);
    expect(out.bars[0]!.amb).toBe(false);
  });

  it("[INVARIANT] keeps the fill bar (stays undecidable) when the fill bar touched a barrier", () => {
    const row = { detected_at: "x", instrument: "XAUUSD", post_entry_path: path, ambiguous_bars: 1 };
    expect(clearUndecisiveFillBar(row)).toBe(row);
  });

  it("[INVARIANT] keeps it when ambiguity count is unknown", () => {
    const row = { detected_at: "x", instrument: "XAUUSD", post_entry_path: path, ambiguous_bars: null };
    expect(clearUndecisiveFillBar(row)).toBe(row);
  });

  it("[INVARIANT] the baseline variant becomes decidable for a cleared path", () => {
    const now = Date.parse("2026-11-20T00:00:00Z");
    const raw = { detected_at: "2026-11-17T12:50:00Z", instrument: "XAUUSD", post_entry_path: path, ambiguous_bars: 0 };
    const before = summariseVariants([raw], now).find((v) => v.variant === "single_exit_first_target")!;
    const after = summariseVariants([clearUndecisiveFillBar(raw)], now).find((v) => v.variant === "single_exit_first_target")!;
    expect(before.undecidable).toBe(1);
    expect(after.undecidable).toBe(0);
  });
});
