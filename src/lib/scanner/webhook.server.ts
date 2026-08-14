/**
 * Tier 2 execution: per-user broker webhook dispatch.
 *
 * We never hold broker credentials. The user points us at their own bridge
 * (PineConnector, a self-hosted EA relay, an automation platform) and we POST a
 * formatted setup to it. The scanning queue must never be held hostage by that
 * endpoint: every POST has its own 5s abort signal and the fan-out is
 * `Promise.allSettled`, so a dead or hanging URL costs at most one timeout and
 * can never throw into the pipeline.
 */

export const WEBHOOK_TIMEOUT_MS = 5_000;

export interface WebhookSignal {
  id: string;
  instrument: string;
  grade: string;
  direction: string;
  entryPrice: number;
  maxAcceptableEntry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number | null;
  rrRatio: number;
  confidence: number;
  tifMinutes: number;
}

export interface WebhookTarget {
  userId: string;
  url: string;
  secret: string | null;
  format: "json" | "pineconnector";
}

function fmt(v: number) {
  return v >= 100 ? v.toFixed(2) : v.toFixed(5);
}

/**
 * PineConnector's single-line comma format. `buy limit` / `sell limit` is used
 * deliberately: after a breakout the only order MetaTrader accepts back at the
 * structural entry is a plain limit — never a stop or stop-limit.
 */
export function pineConnectorPayload(signal: WebhookSignal, licence: string): string {
  const action = signal.direction === "long" ? "buylimit" : "selllimit";
  return [
    licence,
    action,
    signal.instrument,
    `price=${fmt(signal.entryPrice)}`,
    `sl=${fmt(signal.stopLoss)}`,
    `tp=${fmt(signal.tp3 ?? signal.tp2)}`,
    `expiration=${signal.tifMinutes}`,
    `comment=P-Trades ${signal.grade}`,
  ].join(",");
}

export function jsonPayload(signal: WebhookSignal, secret: string | null) {
  return {
    secret,
    event: "signal",
    signal_id: signal.id,
    instrument: signal.instrument,
    action: signal.direction === "long" ? "buy_limit" : "sell_limit",
    grade: signal.grade,
    entry: signal.entryPrice,
    max_acceptable_entry: signal.maxAcceptableEntry,
    stop_loss: signal.stopLoss,
    tp1: signal.tp1,
    tp2: signal.tp2,
    tp3: signal.tp3,
    rr: signal.rrRatio,
    confidence: signal.confidence,
    expires_in_minutes: signal.tifMinutes,
  };
}

async function dispatchOne(signal: WebhookSignal, target: WebhookTarget) {
  const isPine = target.format === "pineconnector";
  const body = isPine
    ? pineConnectorPayload(signal, target.secret ?? "")
    : JSON.stringify(jsonPayload(signal, target.secret));

  const res = await fetch(target.url, {
    method: "POST",
    headers: {
      "content-type": isPine ? "text/plain" : "application/json",
      // Idempotency key so a worker retry cannot double-fire an order.
      "x-ptrades-idempotency-key": `${signal.id}-${target.userId}`,
    },
    body,
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`webhook responded ${res.status}`);
}

/** Fire-and-report: never throws, never blocks longer than one timeout. */
export async function dispatchWebhooks(signal: WebhookSignal, targets: WebhookTarget[]) {
  if (!targets.length) return;
  const results = await Promise.allSettled(
    targets.map(async (t) => {
      try {
        await dispatchOne(signal, t);
      } catch (err) {
        console.error("[webhook] dispatch failed", {
          user: t.userId,
          signal: signal.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed) console.error(`[webhook] ${failed} dispatch(es) rejected for signal ${signal.id}`);
}
