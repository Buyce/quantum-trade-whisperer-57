import { describe, expect, it } from "vitest";
import {
  confirmationActionable,
  confirmationMsRemaining,
  confirmationState,
} from "@/lib/delivery/confirmation";
import { directExecutionAllowed } from "@/lib/execution/direct";

const now = Date.parse("2026-01-01T12:00:00Z");
const base = {
  state: "awaiting_confirmation",
  requiresConfirmation: true,
  confirmedAt: null as string | null,
  confirmationExpiresAt: new Date(now + 60_000).toISOString(),
  declinedAt: null as string | null,
};

describe("confirmation state", () => {
  it("[UNIT] is awaiting inside the window", () => {
    expect(confirmationState(base, now)).toBe("awaiting");
    expect(confirmationActionable(base, now)).toBe(true);
  });

  it("[UNIT] expires once the window has passed and can no longer be acted on", () => {
    const facts = { ...base, confirmationExpiresAt: new Date(now - 1).toISOString() };
    expect(confirmationState(facts, now)).toBe("expired");
    expect(confirmationActionable(facts, now)).toBe(false);
  });

  it("[UNIT] reads a decline as declined even when a confirmation was recorded", () => {
    const facts = {
      ...base,
      confirmedAt: new Date(now).toISOString(),
      declinedAt: new Date(now).toISOString(),
    };
    expect(confirmationState(facts, now)).toBe("declined");
  });

  it("[UNIT] reports no window rather than inventing one", () => {
    expect(confirmationMsRemaining(null, now)).toBeNull();
    expect(confirmationMsRemaining(new Date(now + 5000).toISOString(), now)).toBe(5000);
    expect(confirmationMsRemaining(new Date(now - 5000).toISOString(), now)).toBe(0);
  });
});

describe("live_confirm submission gate", () => {
  const account = {
    mode: "live_confirm" as const,
    brokerAccountType: "real" as const,
    tradeAllowed: true,
    investorMode: false,
    ready: true,
    intentConflict: false,
    globalDemoAuto: true,
    globalLiveAuto: false,
  };

  it("[INVARIANT] refuses without an owner confirmation", () => {
    const verdict = directExecutionAllowed({ ...account, globalLiveConfirm: true });
    expect(verdict.ok).toBe(false);
  });

  it("[INVARIANT] refuses a confirmation while the capability is off system-wide", () => {
    const verdict = directExecutionAllowed({
      ...account,
      globalLiveConfirm: false,
      ownerConfirmed: true,
    });
    expect(verdict.ok).toBe(false);
  });

  it("[INVARIANT] refuses on a non-real account even when confirmed", () => {
    const verdict = directExecutionAllowed({
      ...account,
      brokerAccountType: "demo",
      globalLiveConfirm: true,
      ownerConfirmed: true,
    });
    expect(verdict.ok).toBe(false);
  });

  it("[INVARIANT] allows only a confirmed order on a broker-confirmed real account", () => {
    const verdict = directExecutionAllowed({
      ...account,
      globalLiveConfirm: true,
      ownerConfirmed: true,
    });
    expect(verdict.ok).toBe(true);
  });
});
