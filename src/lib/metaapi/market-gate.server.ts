/**
 * Shared concurrency gate for MetaApi historical market-data reads.
 *
 * The provider enforces a hard cap of 5 concurrent historical market-data
 * requests per account ("ToManyRequestsError"). The scanner cycle, the shadow
 * replay passes and the spec/quote refresh jobs all read candles from the same
 * benchmark account, so without a shared gate they collide and each other's
 * requests queue at the provider until our own 8s abort fires.
 *
 * Two layers:
 *  1. A per-instance gate for calls inside one invocation.
 *  2. A GLOBAL slot budget backed by TTL-expiring database rows, because a
 *     per-instance gate cannot see simultaneous invocations — the failure that
 *     produced the worker-hang incident. A crashed invocation leaks a slot for
 *     at most its TTL, never forever. If the slot store itself is unreachable
 *     the gate degrades to per-instance only rather than blocking all reads.
 */
import { SupabaseClient } from "@supabase/supabase-js";

export const MARKET_DATA_MAX_CONCURRENCY = 4;
/** Provider cap is 5 per account; the global budget mirrors it. */
const GLOBAL_SLOT_TTL_SECONDS = 90;

let active = 0;
const waiters: Array<() => void> = [];

function release(): void {
  const next = waiters.shift();
  if (next) {
    next();
    return;
  }
  active -= 1;
}

async function acquireGlobalSlot(db: SupabaseClient): Promise<number | null> {
  const { data, error } = await db.rpc("acquire_market_data_slot", {
    p_ttl_seconds: GLOBAL_SLOT_TTL_SECONDS,
  });
  if (error) {
    // Degrade to the per-instance gate; never fabricate a slot id.
    console.error("[market-gate] global slot acquire failed:", error.message);
    return -1;
  }
  return (data as number | null) ?? null;
}

/**
 * Run `fn` once a market-data slot is free, locally AND globally. Never
 * swallows errors. When the global budget is exhausted this throws a
 * rate-limit-shaped error so the caller records a throttle, not a fetch
 * failure.
 */
export async function withMarketDataSlot<T>(fn: () => Promise<T>, db?: SupabaseClient): Promise<T> {
  if (active >= MARKET_DATA_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  } else {
    active += 1;
  }

  let globalSlot: number | null = null;
  try {
    if (db) {
      globalSlot = await acquireGlobalSlot(db);
      if (globalSlot === null) {
        throw new Error(
          "TooManyRequestsError: broker market-data concurrency budget exhausted (global slot cap)",
        );
      }
    }
    return await fn();
  } finally {
    if (db && globalSlot !== null && globalSlot > 0) {
      await db.rpc("release_market_data_slot", { p_slot_id: globalSlot }).then(
        () => {},
        () => {},
      );
    }
    release();
  }
}

/** Test-only visibility into the gate's in-flight count. */
export function marketDataInFlight(): number {
  return active;
}
