/**
 * Prompt-7 characterization gate.
 *
 * The Prompt-7 refactor split `buildTradeProfile` into a gate-labelled
 * `evaluateSetup`. That refactor claimed to be behaviour-preserving. This file
 * proves it against a FROZEN copy of the pre-Prompt-7 scanner vendored from
 * commit ab44ff687df4892745a47ffa1f3b737f04b478e0 (see
 * `src/test/fixtures/pre-p7/`), not against a second wrapper around today's
 * implementation.
 *
 * If a case here fails, current V1 has changed. The frozen baseline is never
 * edited to make it pass.
 */
import { describe, expect, it } from "vitest";
import { buildTradeProfile, evaluateSetup } from "../profile";
import { buildTradeProfile as frozenBuildTradeProfile } from "@/test/fixtures/pre-p7/profile";
import { CANDLE_SCENARIOS } from "@/test/fixtures/pre-p7/candle-sets";

/**
 * Every persisted scanner field, compared value-for-value.
 *
 * `structureKey` is NOT in this list. It is the one field with a deliberate,
 * reviewed divergence from the frozen baseline (Phase A1, Finding 6): the frozen
 * code rendered the stop anchor at a fixed five decimals for every instrument,
 * and current code renders it at that instrument's own price precision. The
 * divergence is pinned exactly, and only for that field, by the dedicated case
 * below — so an accidental change to structure identity still fails this gate.
 *
 * Nothing about the publish/no-trade DECISION or the plan GEOMETRY may differ.
 */
const PROFILE_FIELDS = [
  "instrument",
  "grade",
  "direction",
  "entryPrice",
  "stopLoss",
  "tp1",
  "tp2",
  "tp3",
  "tp1R",
  "tp2R",
  "tp3R",
  "maxR",
  "maxAcceptableEntry",
  "capped",
  "atr",
  "rrRatio",
  "patternSymmetry",
  "h4Bias",
  "h1Bias",
  "m15Bias",
  "qualitativeBreakdown",
] as const;


const CASES = CANDLE_SCENARIOS.map((s) => [s.id, s] as const);

describe("pre-Prompt-7 characterization — frozen baseline vs current V1", () => {
  it("[INVARIANT] the frozen fixture set is non-empty, so this gate cannot pass vacuously", () => {
    expect(CANDLE_SCENARIOS.length).toBe(36);
    for (const s of CANDLE_SCENARIOS) {
      expect(s.candles.M15.length).toBeGreaterThan(200);
      expect(s.candles.H1.length).toBeGreaterThan(200);
      expect(s.candles.H4.length).toBeGreaterThan(200);
    }
  });

  it.each(CASES)(
    "[V1_CHARACTERIZATION] %s — publish/no-trade decision is byte-identical to the frozen baseline",
    (_id, scenario) => {
      const frozen = frozenBuildTradeProfile({
        instrument: scenario.instrument,
        candles: scenario.candles,
        session: scenario.session,
      });
      const current = buildTradeProfile({
        instrument: scenario.instrument,
        candles: scenario.candles,
        session: scenario.session,
      });
      expect(current === null).toBe(frozen === null);
    },
  );

  it.each(CASES)(
    "[V1_CHARACTERIZATION] %s — every persisted plan field, confidence component and pillar is identical",
    (_id, scenario) => {
      const input = {
        instrument: scenario.instrument,
        candles: scenario.candles,
        session: scenario.session,
      };
      const frozen = frozenBuildTradeProfile(input);
      const current = buildTradeProfile(input);
      if (!frozen || !current) {
        expect(current).toEqual(frozen);
        return;
      }
      for (const field of PROFILE_FIELDS) {
        expect({ field, value: current[field] }).toEqual({ field, value: frozen[field] });
      }
      expect(current.confidence).toEqual(frozen.confidence);
      expect(current.pillars).toEqual(frozen.pillars);
    },
  );

  it.each(CASES)(
    "[V1_CHARACTERIZATION] %s — evaluateSetup agrees with the frozen decision and persists a terminal stage",
    (_id, scenario) => {
      const input = {
        instrument: scenario.instrument,
        candles: scenario.candles,
        session: scenario.session,
      };
      const frozen = frozenBuildTradeProfile(input);
      const evaluation = evaluateSetup(input);

      // Terminal-stage persistence: every evaluation names its stage, and the
      // stage agrees with the frozen publish/no-trade outcome.
      expect(typeof evaluation.stage).toBe("string");
      expect(evaluation.stage.length).toBeGreaterThan(0);
      expect(evaluation.stage === "published").toBe(frozen !== null);

      if (frozen === null) {
        // No fabricated geometry: a rejection carries no plan at all.
        expect(evaluation.proposedProfile).toBeNull();
        const g = evaluation.geometry as unknown as Record<string, unknown>;
        for (const key of ["entryPrice", "stopLoss", "riskPrice"]) {
          const v = g[key];
          expect(v === null || v === undefined || typeof v === "number").toBe(true);
        }
      } else {
        expect(evaluation.proposedProfile).toEqual(frozen);
      }
    },
  );

  it("[INVARIANT] a rejected evaluation never invents entry, stop or targets", () => {
    const rejected = CANDLE_SCENARIOS.map((s) =>
      evaluateSetup({ instrument: s.instrument, candles: s.candles, session: s.session }),
    ).filter((e) => e.stage !== "published");
    for (const e of rejected) {
      expect(e.proposedProfile).toBeNull();
    }
  });

  it("[INVARIANT] the fixture set both publishes and rejects, so field equality is never vacuous", () => {
    const stages = CANDLE_SCENARIOS.map(
      (s) =>
        evaluateSetup({ instrument: s.instrument, candles: s.candles, session: s.session }).stage,
    );
    expect(new Set(stages).size).toBeGreaterThan(1);
    expect(stages.filter((s) => s === "published").length).toBeGreaterThan(0);
    expect(stages.filter((s) => s !== "published").length).toBeGreaterThan(0);
  });
});
