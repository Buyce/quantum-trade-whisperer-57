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

import type { SupabaseClient } from "@supabase/supabase-js";

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

export interface DispatchAttempt {
  userId: string;
  url: string;
  status: number | null;
  latencyMs: number;
  error: string | null;
}

async function dispatchOne(signal: WebhookSignal, target: WebhookTarget): Promise<DispatchAttempt> {
  const isPine = target.format === "pineconnector";
  const body = isPine
    ? pineConnectorPayload(signal, target.secret ?? "")
    : JSON.stringify(jsonPayload(signal, target.secret));

  const startedAt = Date.now();
  try {
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
    return {
      userId: target.userId,
      url: target.url,
      status: res.status,
      latencyMs: Date.now() - startedAt,
      error: res.ok ? null : `webhook responded ${res.status}`,
    };
  } catch (err) {
    return {
      userId: target.userId,
      url: target.url,
      status: null,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Only the insert path is used, so the client is accepted structurally. */
type DispatchLogger = Pick<SupabaseClient, "from">;

/**
 * Fire-and-report: never throws, never blocks longer than one timeout.
 *
 * Telemetry is written fire-and-forget into `webhook_dispatch_log` — the log is
 * an observability artefact for the admin terminal, so a failing insert must
 * never surface to the trader or the scan worker.
 */
export async function dispatchWebhooks(
  signal: WebhookSignal,
  targets: WebhookTarget[],
  db?: DispatchLogger,
) {
  if (!targets.length) return;
  const attempts = await Promise.all(targets.map((t) => dispatchOne(signal, t)));

  const failed = attempts.filter((a) => a.error !== null);
  for (const a of failed) {
    console.error("[webhook] dispatch failed", {
      user: a.userId,
      signal: signal.id,
      error: a.error,
    });
  }
  if (failed.length) {
    console.error(`[webhook] ${failed.length} dispatch(es) rejected for signal ${signal.id}`);
  }

  if (db) {
    void Promise.resolve(
      db.from("webhook_dispatch_log").insert(
        attempts.map((a) => ({
          signal_id: signal.id,
          user_id: a.userId,
          endpoint_url: a.url,
          http_status: a.status,
          latency_ms: a.latencyMs,
          error: a.error,
        })),
      ),
    ).then(
      () => undefined,
      () => undefined,
    );
  }
}
