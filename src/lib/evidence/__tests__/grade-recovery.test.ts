import { describe, expect, it } from "vitest";

import {
  RECOVERED_GRADE_SOURCE,
  recoveredCharacterisationFields,
  resolveCharacterisationFromDecisions,
  signalTailFromClientId,
  tailMatchesSignalId,
  type DecisionCandidate,
} from "../grade-recovery";

const SIGNAL = "c7d8b8ea-7829-4d19-bd3a-9000ddd2e5ee";
const CLIENT_ID = "PT_19bd3a9000ddd2e5ee_6356";

const decision = (over: Partial<DecisionCandidate> = {}): DecisionCandidate => ({
  signal_id: SIGNAL,
  instrument: "XAUUSD",
  grade: "B",
  created_at: "2026-08-26T17:30:00.000Z",
  ...over,
});

describe("[UNIT] evidence/grade-recovery", () => {
  it("[UNIT] reads the signal tail out of a P-Trades order id", () => {
    expect(signalTailFromClientId(CLIENT_ID)).toBe("19bd3a9000ddd2e5ee");
    expect(signalTailFromClientId("2380001")).toBeNull();
    expect(signalTailFromClientId(null)).toBeNull();
  });

  it("[UNIT] matches the tail against the dash-stripped signal id", () => {
    expect(tailMatchesSignalId("19bd3a9000ddd2e5ee", SIGNAL)).toBe(true);
    expect(tailMatchesSignalId("19bd3a9000ddd2e5ee", "00000000-0000-0000-0000-000000000000")).toBe(
      false,
    );
    expect(tailMatchesSignalId("19bd3a9000ddd2e5ee", null)).toBe(false);
  });

  it("[UNIT] recovers instrument, grade and first-decision time from a unique match", () => {
    const recovered = resolveCharacterisationFromDecisions(CLIENT_ID, "XAUUSD", [
      decision({ created_at: "2026-08-26T18:00:00.000Z" }),
      decision(),
      decision({ signal_id: "11111111-2222-3333-4444-555555555555", grade: "C" }),
    ]);
    expect(recovered).toEqual({
      signalId: SIGNAL,
      instrument: "XAUUSD",
      grade: "B",
      firstDecisionAt: "2026-08-26T17:30:00.000Z",
      source: RECOVERED_GRADE_SOURCE,
    });
  });

  it("[UNIT] writes the recovered fields with their provenance", () => {
    const recovered = resolveCharacterisationFromDecisions(CLIENT_ID, "XAUUSD", [decision()])!;
    expect(recoveredCharacterisationFields(recovered)).toEqual({
      // `signal_ref`, not `signal_id`: the original setup row is gone, so a
      // foreign key to it cannot be written.
      signal_ref: SIGNAL,
      signal_instrument: "XAUUSD",
      signal_grade: "B",
      signal_grade_source: RECOVERED_GRADE_SOURCE,
      signal_first_decision_at: "2026-08-26T17:30:00.000Z",
    });
  });
});

describe("[INVARIANT] evidence/grade-recovery refuses anything ambiguous", () => {
  it("[INVARIANT] refuses when two different signals share the tail", () => {
    expect(
      resolveCharacterisationFromDecisions(CLIENT_ID, "XAUUSD", [
        decision(),
        decision({ signal_id: "aaaaaaaa-bbbb-4c19-bd3a-9000ddd2e5ee" }),
      ]),
    ).toBeNull();
  });

  it("[INVARIANT] refuses when the decision log disagrees on the grade", () => {
    expect(
      resolveCharacterisationFromDecisions(CLIENT_ID, "XAUUSD", [
        decision(),
        decision({ grade: "C" }),
      ]),
    ).toBeNull();
  });

  it("[INVARIANT] refuses when the decision instrument contradicts the broker symbol", () => {
    expect(
      resolveCharacterisationFromDecisions(CLIENT_ID, "EURUSD", [decision({ instrument: "XAUUSD" })]),
    ).toBeNull();
  });

  it("[INVARIANT] refuses a grade value P-Trades never publishes, and an empty log", () => {
    expect(
      resolveCharacterisationFromDecisions(CLIENT_ID, "XAUUSD", [decision({ grade: "D" })]),
    ).toBeNull();
    expect(resolveCharacterisationFromDecisions(CLIENT_ID, "XAUUSD", [])).toBeNull();
  });
});
