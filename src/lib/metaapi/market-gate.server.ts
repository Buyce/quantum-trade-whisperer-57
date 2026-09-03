/**
 * Shared concurrency gate for MetaApi historical market-data reads.
 *
 * The provider enforces a hard cap of 5 concurrent historical market-data
 * requests per account ("ToManyRequestsError"). The scanner cycle, the shadow
 * replay passes and the spec/quote refresh jobs all read candles from the same
 * benchmark account, so without a shared gate they can collide and each other's
 * requests queue at the provider until our own 8s abort fires.
 *
 * The gate is per worker instance (there is no cross-invocation lock), which is
 * exactly where the collisions we can control happen: inside one job that fans
 * out, and between passes running in the same invocation.
 */
export const MARKET_DATA_MAX_CONCURRENCY = 4;

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

/** Run `fn` once a market-data slot is free. Never swallows errors. */
export async function withMarketDataSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MARKET_DATA_MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  } else {
    active += 1;
  }
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Test-only visibility into the gate's in-flight count. */
export function marketDataInFlight(): number {
  return active;
}
