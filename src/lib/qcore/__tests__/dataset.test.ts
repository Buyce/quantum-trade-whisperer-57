import { describe, expect, it } from "vitest";
import { joinQCoreOutcomes, parseQCoreInput } from "../dataset.server";
import { QCORE_POLICY_V2 } from "../config";

const input = {
  direction: "long",
  trend: 90,
  orderBlock: 80,
  momentum: 70,
  volatilityExpansion: 65,
  rr: 2.2,
  maxR: 2.8,
  regimeWinRate: null,
  regimeActive: false,
  executionQuality: null,
};

const observation = {
  observation_key: "run|XAUUSD",
  instrument: "XAUUSD",
  code_hash: QCORE_POLICY_V2.id,
  profile: {
    policyId: QCORE_POLICY_V2.id,
    featureSchemaVersion: QCORE_POLICY_V2.featureSchemaVersion,
    input,
  },
};

describe("Q-Core research dataset", () => {
  it("[UNIT] requires the exact persisted decision-time input snapshot", () => {
    expect(parseQCoreInput(observation.profile)).toEqual(input);
    expect(parseQCoreInput({ ...observation.profile, input: undefined })).toBeNull();
    expect(parseQCoreInput({ ...observation.profile, policyId: "old-policy" })).toBeNull();
  });

  it("[UNIT] joins a resolved Replay-V2 outcome by observation identity", () => {
    const rows = joinQCoreOutcomes(
      [observation],
      [
        {
          observation_key: "run|XAUUSD",
          instrument: "XAUUSD",
          detected_at: "2026-09-27T00:00:00Z",
          status: "resolved",
          resolved_outcome: "tp1",
          data_quality_outcome: null,
          realized_r: 1,
          filled_at: "2026-09-27T01:00:00Z",
        },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.realizedR).toBe(1);
    expect(rows[0]?.filled).toBe(true);
  });

  it("[UNIT] uses 0R for a matured never-filled plan and excludes invalid labels", () => {
    const base = {
      observation_key: "run|XAUUSD",
      instrument: "XAUUSD",
      detected_at: "2026-09-27T00:00:00Z",
      status: "resolved",
      filled_at: null,
    };
    const never = joinQCoreOutcomes(
      [observation],
      [
        {
          ...base,
          resolved_outcome: "never_filled",
          data_quality_outcome: null,
          realized_r: null,
        },
      ],
    );
    expect(never[0]?.realizedR).toBe(0);
    expect(never[0]?.filled).toBe(false);

    const invalid = joinQCoreOutcomes(
      [observation],
      [
        {
          ...base,
          resolved_outcome: null,
          data_quality_outcome: "invalid_plan",
          realized_r: null,
        },
      ],
    );
    expect(invalid[0]?.realizedR).toBeNull();
    expect(invalid[0]?.filled).toBeNull();
  });

  it("[UNIT] fails closed on policy mismatch instead of mixing evidence", () => {
    expect(joinQCoreOutcomes([{ ...observation, code_hash: "other-policy" }], [])).toEqual([]);
  });
});
