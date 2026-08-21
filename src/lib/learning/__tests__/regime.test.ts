import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MIN_N_FILL,
  MIN_N_TIER3,
  MIN_N_WIN,
  lookupRegime,
  tierLabel,
  volBucketOf,
  type RegimeStatRow,
} from "../regime";

const SEED = 20_260_821;

function row(
  over: Partial<RegimeStatRow> & Pick<RegimeStatRow, "tier" | "regime_key">,
): RegimeStatRow {
  return {
    instrument: null,
    direction: null,
    session: null,
    vol_bucket: null,
    n_total: 0,
    n_filled: 0,
    wins: 0,
    p_fill_shrunk: 0.5,
    p_win_shrunk: 0.5,
    vol_t1: null,
    vol_t2: null,
    ...over,
  };
}

const GLOBAL = row({
  tier: 1,
  regime_key: "global",
  n_total: 300,
  n_filled: 250,
  p_fill_shrunk: 0.4,
  p_win_shrunk: 0.3,
});
const BOUNDS = row({ tier: 0, regime_key: "EURUSD", instrument: "EURUSD", vol_t1: 1, vol_t2: 2 });
const TIER2 = row({
  tier: 2,
  regime_key: "EURUSD|long",
  instrument: "EURUSD",
  direction: "long",
  n_total: 120,
  n_filled: 60,
  p_fill_shrunk: 0.5,
  p_win_shrunk: 0.45,
});

const QUERY = { instrument: "EURUSD", direction: "long", session: "london", volatilityIndex: 1.5 };

describe("volBucketOf", () => {
  it("[UNIT] terciles map to low/mid/high on the stored boundaries", () => {
    expect(volBucketOf(0.5, 1, 2)).toBe("low");
    expect(volBucketOf(1, 1, 2)).toBe("low");
    expect(volBucketOf(1.5, 1, 2)).toBe("mid");
    expect(volBucketOf(2, 1, 2)).toBe("mid");
    expect(volBucketOf(2.5, 1, 2)).toBe("high");
  });

  it("[INVARIANT] a missing volatility reading or missing boundaries is 'unknown', never guessed", () => {
    expect(volBucketOf(null, 1, 2)).toBe("unknown");
    expect(volBucketOf(1.5, null, 2)).toBe("unknown");
    expect(volBucketOf(1.5, 1, null)).toBe("unknown");
  });
});

describe("lookupRegime — hierarchy and gates", () => {
  it("[INVARIANT] no global row means no prior at all", () => {
    expect(lookupRegime([TIER2], QUERY)).toBeNull();
  });

  it("[UNIT] a thin tier-3 bucket is skipped and the skip is reported honestly", () => {
    const thin = row({
      tier: 3,
      regime_key: "EURUSD|long|london|mid",
      n_total: MIN_N_TIER3 - 1,
      n_filled: 5,
      p_fill_shrunk: 0.9,
      p_win_shrunk: 0.9,
    });
    const prior = lookupRegime([GLOBAL, BOUNDS, TIER2, thin], QUERY)!;
    expect(prior.tier).toBe(2);
    expect(prior.tier3SkippedN).toBe(MIN_N_TIER3 - 1);
    expect(prior.pFill).toBeCloseTo(0.5, 6);
  });

  it("[UNIT] an eligible tier-3 bucket answers the lookup", () => {
    const thick = row({
      tier: 3,
      regime_key: "EURUSD|long|london|mid",
      n_total: MIN_N_TIER3,
      n_filled: 12,
      p_fill_shrunk: 0.6,
      p_win_shrunk: 0.55,
    });
    const prior = lookupRegime([GLOBAL, BOUNDS, TIER2, thick], QUERY)!;
    expect(prior.tier).toBe(3);
    expect(prior.tier3SkippedN).toBeNull();
    expect(prior.pJoint).toBeCloseTo(Number((0.6 * 0.55).toFixed(4)), 6);
  });

  it("[UNIT] a null stored probability stays null — no fabricated 0.5 prior", () => {
    const prior = lookupRegime(
      [{ ...GLOBAL, n_total: 0, n_filled: 0, wins: 0, p_fill_shrunk: null, p_win_shrunk: null }],
      QUERY,
    )!;
    expect(prior.pFill).toBeNull();
    expect(prior.pWin).toBeNull();
    expect(prior.pJoint).toBeNull();
    expect(prior.status).toBe("unavailable");
    expect(prior.reason).toBe("no_resolved_samples");
  });

  it("[UNIT] a defined fill probability with no filled samples reports win as unavailable", () => {
    const prior = lookupRegime(
      [{ ...GLOBAL, n_total: 10, n_filled: 0, wins: 0, p_fill_shrunk: 0.3, p_win_shrunk: null }],
      QUERY,
    )!;
    expect(prior.pFill).toBeCloseTo(0.3, 6);
    expect(prior.pWin).toBeNull();
    expect(prior.pJoint).toBeNull();
    expect(prior.status).toBe("unavailable");
    expect(prior.reason).toBe("no_filled_samples");
  });

  it("[UNIT] status is learning while a gate is open and active once both clear", () => {
    const learning = lookupRegime([{ ...GLOBAL, n_total: MIN_N_FILL - 1 }], QUERY)!;
    expect(learning.status).toBe("learning");
    expect(learning.reason).toBe("fill_gate_open");
    const active = lookupRegime([{ ...GLOBAL, n_total: MIN_N_FILL, n_filled: MIN_N_WIN }], QUERY)!;
    expect(active.status).toBe("active");
    expect(active.reason).toBe("both_gates_passed");
  });

  it("[UNIT] falls back to global when the instrument has no tier-2 row", () => {
    const prior = lookupRegime([GLOBAL], { ...QUERY, instrument: "GBPAUD" })!;
    expect(prior.tier).toBe(1);
  });

  it("[UNIT] activation gates flip exactly at the documented sample thresholds", () => {
    const belowFill = lookupRegime(
      [{ ...GLOBAL, n_total: MIN_N_FILL - 1, n_filled: MIN_N_WIN - 1 }],
      QUERY,
    )!;
    expect(belowFill.fillGatePassed).toBe(false);
    expect(belowFill.winGatePassed).toBe(false);
    const atGates = lookupRegime([{ ...GLOBAL, n_total: MIN_N_FILL, n_filled: MIN_N_WIN }], QUERY)!;
    expect(atGates.fillGatePassed).toBe(true);
    expect(atGates.winGatePassed).toBe(true);
  });

  it("[UNIT] tier labels are human-readable and stable", () => {
    expect(tierLabel(3)).toBe("This exact regime");
    expect(tierLabel(2)).toBe("Instrument + direction");
    expect(tierLabel(1)).toBe("All instruments");
  });

  it("[INVARIANT] probabilities stay in [0,1] and finite for arbitrary stored values", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: false }),
        fc.double({ min: -1e6, max: 1e6, noNaN: false }),
        fc.integer({ min: -10, max: 10_000 }),
        fc.integer({ min: -10, max: 10_000 }),
        (pFill, pWin, nTotal, nFilled) => {
          const prior = lookupRegime(
            [
              {
                ...GLOBAL,
                p_fill_shrunk: pFill,
                p_win_shrunk: pWin,
                n_total: nTotal,
                n_filled: nFilled,
              },
            ],
            QUERY,
          )!;
          // Null is a legal answer (an undefined statistic); a number must be a
          // finite probability. What must never happen is a fabricated midpoint.
          for (const v of [prior.pFill, prior.pWin, prior.pJoint]) {
            if (v === null) continue;
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
          if (prior.pJoint != null) {
            expect(prior.pJoint).toBeLessThanOrEqual(
              Math.min(prior.pFill as number, prior.pWin as number) + 1e-9,
            );
          }
          return true;
        },
      ),
      { seed: SEED, numRuns: 400 },
    );
  });
});
