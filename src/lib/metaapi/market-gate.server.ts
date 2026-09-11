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
 *     at most its TTL, never forever. If the slot store itself is unreachable,
 *     reads fail closed rather than risking a cross-instance provider overload.
 *
 * NOTHING HERE MAY WAIT FOREVER. A cancelled request never runs its cleanup, so
 * an unbounded waiter queue plus a bare in-flight counter used to leak capacity
 * permanently: the instance's gate stayed full, the next candle read waited with
 * no deadline, and the platform cancelled the whole pass as hung. Every wait is
 * now bounded, and capacity is derived from the live set of holders rather than
 * an incrementing number, so a leak cannot outlive its own deadline.
 */
import { SupabaseClient } from "@supabase/supabase-js";
import { MetaApiCapacityError, MetaApiRequestAbortedError } from "./errors";

export const MARKET_DATA_MAX_CONCURRENCY = 4;
/** Provider cap is 5 per account; the global budget mirrors it. */
const GLOBAL_SLOT_TTL_SECONDS = 90;
/** Longest a candle read may wait for a local slot before giving up. */
export const MARKET_DATA_WAIT_TIMEOUT_MS = 12_000;
/**
 * Hard ceiling on how long one holder may occupy a local slot. Broker reads are
 * individually abort-guarded at 8s; anything past this is a leak (a cancelled
 * request whose `finally` never ran) and its slot is reclaimed.
 */
const HOLDER_MAX_AGE_MS = 30_000;

/** Live holders, by token, with the time each took its slot. */
const holders = new Map<symbol, number>();
type Waiter = { resolve: () => void; reject: (err: Error) => void; settled: boolean };
const waiters: Waiter[] = [];

/** Drop holders that can no longer be running; a cancelled pass leaves these. */
function reapExpiredHolders(now: number): void {
  for (const [token, since] of holders) {
    if (now - since > HOLDER_MAX_AGE_MS) holders.delete(token);
  }
}

function pump(): void {
  while (waiters.length > 0 && holders.size < MARKET_DATA_MAX_CONCURRENCY) {
    const next = waiters.shift();
    if (!next || next.settled) continue;
    next.settled = true;
    next.resolve();
  }
}

function acquireLocal(token: symbol, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new MetaApiRequestAbortedError());
  const now = Date.now();
  reapExpiredHolders(now);
  if (holders.size < MARKET_DATA_MAX_CONCURRENCY) {
    holders.set(token, now);
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = { settled: false, resolve: () => {}, reject: () => {} };
    const remove = () => {
      const idx = waiters.indexOf(waiter);
      if (idx >= 0) waiters.splice(idx, 1);
    };
    const onAbort = () => {
      if (waiter.settled) return;
      waiter.settled = true;
      clearTimeout(timer);
      remove();
      reject(new MetaApiRequestAbortedError());
    };
    const timer = setTimeout(() => {
      if (waiter.settled) return;
      waiter.settled = true;
      remove();
      signal?.removeEventListener("abort", onAbort);
      reject(new MetaApiCapacityError(`Market-data capacity was unavailable for ${MARKET_DATA_WAIT_TIMEOUT_MS}ms`));
    }, MARKET_DATA_WAIT_TIMEOUT_MS);
    waiter.resolve = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      holders.set(token, Date.now());
      resolve();
    };
    waiter.reject = (err: Error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    };
    waiters.push(waiter);
    signal?.addEventListener("abort", onAbort, { once: true });
    // A holder may have expired while this waiter was being registered.
    reapExpiredHolders(Date.now());
    pump();
  });
}

function releaseLocal(token: symbol): void {
  holders.delete(token);
  pump();
}

async function acquireGlobalSlot(db: SupabaseClient): Promise<number | null> {
  const { data, error } = await db.rpc("acquire_market_data_slot", {
    p_ttl_seconds: GLOBAL_SLOT_TTL_SECONDS,
  });
  if (error) {
    console.error("[market-gate] global slot acquire failed:", error.message);
    throw new MetaApiCapacityError("Shared market-data capacity could not be confirmed");
  }
  return (data as number | null) ?? null;
}

/**
 * Run `fn` once a market-data slot is free, locally AND globally. Never
 * swallows errors, and never waits without a deadline. When either budget is
 * exhausted this throws a rate-limit-shaped error so the caller records a
 * throttle, not a fetch failure.
 */
export async function withMarketDataSlot<T>(
  fn: () => Promise<T>,
  db?: SupabaseClient,
  signal?: AbortSignal,
): Promise<T> {
  const token = Symbol("market-data-slot");
  await acquireLocal(token, signal);

  let globalSlot: number | null = null;
  try {
    if (db) {
      globalSlot = await acquireGlobalSlot(db);
      if (signal?.aborted) throw new MetaApiRequestAbortedError();
      if (globalSlot === null) {
        throw new MetaApiCapacityError("Broker market-data capacity is temporarily full");
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
    releaseLocal(token);
  }
}

/** Test-only visibility into the gate's in-flight count. */
export function marketDataInFlight(): number {
  reapExpiredHolders(Date.now());
  return holders.size;
}
