import { describe, expect, it } from "vitest";
import {
  describePhase,
  evaluateIntent,
  isConnectionReady,
  maskLogin,
  planDisconnect,
  type AccountPhase,
} from "../lifecycle";
import { HELP_TOPICS, STAGE_CAPABILITY_NOTE, capabilityNote, isOfferedRegion } from "../guidance";

describe("connected-account intent vs broker truth", () => {
  it("[INVARIANT] a Demo intent connected to a REAL account is stopped and warned", () => {
    const verdict = evaluateIntent("demo", "real");
    expect(verdict.conflict).toBe(true);
    expect(verdict.reason).toMatch(/REAL money account/);
    expect(
      isConnectionReady({ phase: "connected", brokerAccountType: "real", intentConflict: true }),
    ).toBe(false);
  });

  it("[INVARIANT] a Live intent connected to a demo or contest account is stopped", () => {
    expect(evaluateIntent("live", "demo").conflict).toBe(true);
    expect(evaluateIntent("live", "contest").conflict).toBe(true);
  });

  it("[UNIT] matching intent and broker type is not a conflict", () => {
    expect(evaluateIntent("demo", "demo")).toEqual({ conflict: false, reason: null });
    expect(evaluateIntent("live", "real")).toEqual({ conflict: false, reason: null });
  });

  it("[INVARIANT] an unknown broker type is an absent answer, not a conflict, and never READY", () => {
    expect(evaluateIntent("demo", "unknown").conflict).toBe(false);
    expect(
      isConnectionReady({ phase: "connected", brokerAccountType: "unknown", intentConflict: false }),
    ).toBe(false);
  });

  it("[INVARIANT] READY requires a broker-confirmed type with no conflict", () => {
    expect(
      isConnectionReady({ phase: "connected", brokerAccountType: "demo", intentConflict: false }),
    ).toBe(true);
    expect(
      isConnectionReady({
        phase: "awaiting_credentials",
        brokerAccountType: "demo",
        intentConflict: false,
      }),
    ).toBe(false);
  });
});

describe("connected-account lifecycle copy", () => {
  const PHASES: AccountPhase[] = [
    "created",
    "awaiting_credentials",
    "deploying",
    "deployed_not_connected",
    "connected",
    "broker_rejected",
    "undeployed",
    "failed",
    "ready",
  ];

  it("[INVARIANT] every phase has non-empty copy", () => {
    for (const phase of PHASES) {
      const copy = describePhase(phase);
      expect(copy.label.length).toBeGreaterThan(3);
      expect(copy.detail.length).toBeGreaterThan(20);
    }
  });

  it("[INVARIANT] credentials-submitted is never presented as connected", () => {
    expect(describePhase("awaiting_credentials").label).not.toMatch(/connected/i);
    expect(describePhase("awaiting_credentials").tone).toBe("pending");
    expect(describePhase("deployed_not_connected").tone).toBe("working");
  });

  it("[INVARIANT] failure phases explain what did NOT happen", () => {
    expect(describePhase("failed").detail).toMatch(/Nothing was traded/i);
    expect(describePhase("broker_rejected").tone).toBe("error");
  });
});

describe("safe disconnect", () => {
  it("[INVARIANT] disconnecting removes the remote connection and keeps recorded history", () => {
    const plan = planDisconnect({ hasRemoteAccount: true });
    expect(plan.removeRemote).toBe(true);
    expect(plan.keepsHistory).toBe(true);
    expect(plan.summary).toMatch(/broker account itself is untouched/i);
  });

  it("[UNIT] a connection that never reached the provider needs no remote removal", () => {
    expect(planDisconnect({ hasRemoteAccount: false }).removeRemote).toBe(false);
  });
});

describe("broker login masking", () => {
  it("[INVARIANT] never reveals a full broker login", () => {
    expect(maskLogin(5053558014)).toBe("••••8014");
    expect(maskLogin("12")).toBe("••12");
    expect(maskLogin(null)).toBeNull();
    expect(maskLogin("")).toBeNull();
  });
});

describe("onboarding guidance", () => {
  it("[INVARIANT] the help never asks for a MetaTrader password inside P-Trades", () => {
    const password = HELP_TOPICS.find((t) => t.id === "password");
    expect(password?.answer).toMatch(/never receives, stores or logs your MetaTrader password/);
    for (const topic of HELP_TOPICS) {
      expect(topic.whereToLook.join(" ")).not.toMatch(/P-Trades .*password/i);
    }
  });

  it("[INVARIANT] every help topic tells the trader where to physically look, or needs no lookup", () => {
    for (const topic of HELP_TOPICS) {
      expect(topic.question.endsWith("?")).toBe(true);
      expect(topic.answer.length).toBeGreaterThan(40);
    }
    expect(HELP_TOPICS.some((t) => t.id === "server" && t.whereToLook.length > 0)).toBe(true);
  });

  it("[INVARIANT] with nothing armed the page says nothing is armed, without denying Demo Auto", () => {
    expect(capabilityNote([])).toBe(STAGE_CAPABILITY_NOTE);
    expect(STAGE_CAPABILITY_NOTE).toMatch(/Observe mode/);
    expect(STAGE_CAPABILITY_NOTE).toMatch(/Nothing is armed right now/);
    expect(STAGE_CAPABILITY_NOTE).not.toMatch(/does not place, change or close any order/);
    expect(STAGE_CAPABILITY_NOTE).toMatch(/real money stay switched off/);
  });

  it("[INVARIANT] an armed account is never described as observe-only", () => {
    const note = capabilityNote([
      { label: "Demo 1", mode: "demo_auto" },
      { label: "Watch", mode: "observe" },
    ]);
    expect(note).not.toMatch(/does not place, change or close any order/);
    expect(note).toMatch(/Demo 1/);
    expect(note).toMatch(/pending orders/);
  });

  it("[UNIT] only offered regions are accepted", () => {
    expect(isOfferedRegion("london")).toBe(true);
    expect(isOfferedRegion("evil.example.com")).toBe(false);
    expect(isOfferedRegion("LONDON")).toBe(false);
  });
});
