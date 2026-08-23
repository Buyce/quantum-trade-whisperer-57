/**
 * Breaker semantics: tripping must not be terminal. Before the cooldown existed
 * a tripped breaker returned early forever, so `consecutive_failures` stuck at 5
 * and shadow replay never resumed without a manual database edit.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SHADOW_BREAKER_COOLDOWN_MS,
  noteShadowRun,
  shadowBreakerGate,
} from "@/lib/execution/shadow_worker.server";

interface Row {
  paused: boolean;
  paused_until: string | null;
  consecutive_failures: number;
  last_error?: string | null;
  last_run_at?: string | null;
}

function fakeDb(row: Row) {
  const state = { ...row };
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state, error: null }) }),
      }),
      update: (patch: Partial<Row>) => ({
        eq: async () => {
          Object.assign(state, patch);
          return { error: null };
        },
      }),
    }),
  } as unknown as SupabaseClient;
  return { db, state };
}

describe("shadowBreakerGate", () => {
  it("[INVARIANT] allows a normal pass when not paused", async () => {
    const { db } = fakeDb({ paused: false, paused_until: null, consecutive_failures: 0 });
    expect(await shadowBreakerGate(db)).toMatchObject({ allowed: true, probe: false });
  });

  it("[INVARIANT] blocks while the cooldown is still running", async () => {
    const { db } = fakeDb({
      paused: true,
      paused_until: new Date(Date.now() + 30 * 60_000).toISOString(),
      consecutive_failures: 5,
    });
    expect(await shadowBreakerGate(db)).toMatchObject({ allowed: false, probe: false });
  });

  it("[INVARIANT] allows exactly one probe once the cooldown has elapsed", async () => {
    const { db } = fakeDb({
      paused: true,
      paused_until: new Date(Date.now() - 60_000).toISOString(),
      consecutive_failures: 5,
    });
    expect(await shadowBreakerGate(db)).toMatchObject({ allowed: true, probe: true });
  });

  it("[INVARIANT] treats a missing cooldown (legacy tripped row) as due", async () => {
    const { db } = fakeDb({ paused: true, paused_until: null, consecutive_failures: 5 });
    expect(await shadowBreakerGate(db)).toMatchObject({ allowed: true, probe: true });
  });
});

describe("noteShadowRun", () => {
  it("[INVARIANT] trips with a cooldown on the fifth consecutive failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T04:00:00Z"));
    const { db, state } = fakeDb({ paused: false, paused_until: null, consecutive_failures: 4 });
    await noteShadowRun(db, { failure: true, error: "All instrument candle fetches failed" });
    expect(state.consecutive_failures).toBe(5);
    expect(state.paused).toBe(true);
    expect(Date.parse(state.paused_until!)).toBe(Date.now() + SHADOW_BREAKER_COOLDOWN_MS);
    vi.useRealTimers();
  });

  it("[INVARIANT] clears the breaker on a successful pass", async () => {
    const { db, state } = fakeDb({
      paused: true,
      paused_until: new Date().toISOString(),
      consecutive_failures: 5,
    });
    await noteShadowRun(db, { failure: false, error: null });
    expect(state).toMatchObject({ paused: false, consecutive_failures: 0, paused_until: null });
  });

  it("[INVARIANT] extends the cooldown when a probe pass fails again", async () => {
    const { db, state } = fakeDb({
      paused: true,
      paused_until: new Date(Date.now() - 1000).toISOString(),
      consecutive_failures: 5,
    });
    await noteShadowRun(db, { failure: true, error: "All instrument candle fetches failed" });
    expect(state.consecutive_failures).toBe(6);
    expect(state.paused).toBe(true);
    expect(Date.parse(state.paused_until!)).toBeGreaterThan(Date.now());
  });
});
