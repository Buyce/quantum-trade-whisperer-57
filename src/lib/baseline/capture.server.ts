/**
 * Quantitative Integrity Baseline capture.
 *
 * Server-only. Reads live rows with the service-role client, computes one
 * immutable metrics document and stores it in `baseline_snapshots`, pinned to a
 * specific append-only `regime_snapshots.run_id`.
 *
 * WHY PINNED: `regime_stats` is deleted and rebuilt every hour, and
 * `purge_expired_signals()` hard-deletes expired signals, so a "live baseline"
 * silently changes underneath the reader. The pinned run id is also the
 * idempotency key — capturing twice against the same run is a no-op.
 *
 * ZERO-HALLUCINATION: every number is an aggregate over rows that exist. Where
 * the data cannot support a statistic, the field is null and the reason is
 * recorded in `caveats` — never a plausible default.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_MODEL_LABEL, ACTIVE_MODEL_VERSION } from "@/lib/versioning";

const READ_CAP = 5000;

export interface WilsonInterval {
  k: number;
  n: number;
  rate: number | null;
  lo: number | null;
  hi: number | null;
}

/** Wilson score interval — correct at small n, unlike the normal approximation. */
export function wilson(k: number, n: number, z = 1.96): WilsonInterval {
  if (n <= 0) return { k, n, rate: null, lo: null, hi: null };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    k,
    n,
    rate: round(p, 4),
    lo: round(Math.max(0, (centre - spread) / d), 4),
    hi: round(Math.min(1, (centre + spread) / d), 4),
  };
}

function round(v: number | null, dp = 4): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Number(v.toFixed(dp));
}

function quantile(values: number[], q: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const value = xs[lo]! + (xs[hi]! - xs[lo]!) * (pos - lo);
  return round(value, 4);
}

function mean(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0) return null;
  return round(xs.reduce((a, b) => a + b, 0) / xs.length, 4);
}

function tally<T extends string>(keys: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
}

interface ShadowRow {
  grade: string;
  instrument: string;
  direction: string;
  trading_session: string | null;
  status: string;
  resolved_outcome: string | null;
  ml_target_label: number | null;
  realized_r: number | null;
  miss_distance_atr: number | null;
  max_r: number | null;
  risk_price: number | null;
  atr: number | null;
  signal_id: string | null;
  detected_at: string;
  resolved_at: string | null;
}

export interface SourceCoverage {
  rows: number;
  timestamp_column: string;
  earliest: string | null;
  latest: string | null;
  retention: string;
}

/** Earliest/latest bound of a source at or before the cutoff. */
async function coverage(
  db: SupabaseClient,
  table: string,
  column: string,
  cutoff: string,
  retention: string,
): Promise<SourceCoverage> {
  const base = () => db.from(table).select(column).lte(column, cutoff);
  const [count, first, last] = await Promise.all([
    db.from(table).select("*", { count: "exact", head: true }).lte(column, cutoff),
    base().order(column, { ascending: true }).limit(1).maybeSingle(),
    base().order(column, { ascending: false }).limit(1).maybeSingle(),
  ]);
  const pick = (r: { data: unknown }) =>
    ((r.data as Record<string, string> | null)?.[column] as string | undefined) ?? null;
  return {
    rows: count.count ?? 0,
    timestamp_column: column,
    earliest: pick(first),
    latest: pick(last),
    retention,
  };
}

export interface BaselineResult {
  captured: boolean;
  reason?: string;
  pinnedRunId: string | null;
  metrics: Record<string, unknown>;
}


export async function captureBaseline(
  db: SupabaseClient,
  opts: { kind?: string } = {},
): Promise<BaselineResult> {
  const kind = opts.kind ?? "quantitative_integrity";
  const caveats: string[] = [];

  // 1. Pin an append-only learning run. Never read `regime_stats`: it is
  //    rebuilt hourly, so it cannot anchor an immutable document.
  const pinned = await db
    .from("regime_snapshots")
    .select("run_id, computed_at")
    .eq("model_version", ACTIVE_MODEL_VERSION)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pinned.error) throw new Error(`regime_snapshots read failed: ${pinned.error.message}`);
  const pinnedRunId = (pinned.data?.run_id as string | undefined) ?? null;
  const pinnedRunAt = (pinned.data?.computed_at as string | undefined) ?? null;
  if (!pinnedRunId) {
    return {
      captured: false,
      reason:
        "The learning engine has not completed an iteration yet, so there is no immutable run to pin the baseline to.",
      pinnedRunId: null,
      metrics: {},
    };
  }

  // 1b. The semantic instant of the document. Every time-varying source is cut
  //     off here, so the capture is a point-in-time snapshot rather than a smear
  //     across the read window. `captured_at` is wall-clock bookkeeping only.
  const dataAsOf = pinnedRunAt ?? new Date().toISOString();
  caveats.push(
    `Every counter in this document is as of data_as_of=${dataAsOf} (the pinned learning run). Rows written or resolved after that instant are excluded by construction, so these numbers will not match a live dashboard read.`,
  );

  const firstRun = await db
    .from("regime_snapshots")
    .select("computed_at")
    .eq("model_version", ACTIVE_MODEL_VERSION)
    .order("computed_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const pinnedRows = await db
    .from("regime_snapshots")
    .select("tier, regime_key, n_total, n_filled, wins, p_fill_shrunk, p_win_shrunk")
    .eq("run_id", pinnedRunId);
  if (pinnedRows.error) throw new Error(pinnedRows.error.message);
  const pinnedTier0 = (
    (pinnedRows.data ?? []) as Array<{ tier: number }>
  ).filter((r) => Number(r.tier) === 0).length;
  if (pinnedTier0 === 0) {
    caveats.push(
      "The pinned learning run carries no Tier-0 rows, so the volatility tercile boundaries in force at that instant are unrecoverable. Tier-0 rows are preserved prospectively from the migration that introduced them onward; no historical boundary has been reconstructed.",
    );
  }

  // 2. Shadow replay cohort — the only auditable performance record. A row is
  //    treated as resolved only if its resolution existed at the cutoff.
  const shadow = await db
    .from("shadow_executions")
    .select(
      "grade, instrument, direction, trading_session, status, resolved_outcome, ml_target_label, realized_r, miss_distance_atr, max_r, risk_price, atr, signal_id, detected_at, resolved_at",
    )
    .eq("model_version", ACTIVE_MODEL_VERSION)
    // Production replay labeller only.
    .eq("replay_version", REPLAY_V1_VERSION)
    .lte("detected_at", dataAsOf)
    .limit(READ_CAP);
  if (shadow.error) throw new Error(`shadow_executions read failed: ${shadow.error.message}`);
  const shadowRows = (shadow.data ?? []) as unknown as ShadowRow[];
  const resolvedAtCutoff = (r: ShadowRow) =>
    r.status === "resolved" && r.resolved_at != null && r.resolved_at <= dataAsOf;
  const resolved = shadowRows.filter(resolvedAtCutoff);
  const resolvedAfterCutoff = shadowRows.filter(
    (r) => r.status === "resolved" && !resolvedAtCutoff(r),
  ).length;
  if (resolvedAfterCutoff > 0) {
    caveats.push(
      `${resolvedAfterCutoff} enrolled shadow rows were resolved after data_as_of and are counted as unresolved here; including them would leak outcomes that did not exist at the pinned instant.`,
    );
  }
  const filled = resolved.filter((r) => r.resolved_outcome !== "never_filled");
  const wins = resolved.filter((r) => r.ml_target_label === 1);
  const neverFilled = resolved.filter((r) => r.resolved_outcome === "never_filled");

  const fillRate = wilson(filled.length, resolved.length);
  const winIfFilled = wilson(wins.length, filled.length);
  const unconditional =
    fillRate.rate === null || winIfFilled.rate === null
      ? null
      : round(fillRate.rate * winIfFilled.rate, 4);

  if (resolved.length === 0) {
    caveats.push("No resolved shadow rows: every performance field is null by construction.");
  }
  const sessionless = resolved.filter((r) => !r.trading_session).length;
  if (sessionless > 0) {
    caveats.push(
      `${sessionless} of ${resolved.length} resolved rows carry no session label; they are reported under "unknown" and must never be folded into a named session.`,
    );
  }
  if (resolved.filter((r) => r.resolved_outcome === "expired").length === 0) {
    caveats.push(
      "The 24h vertical-barrier branch of the replay has never fired in production; it is covered by unit fixtures only.",
    );
  }

  // 3. Signals actually published, and the retention gap.
  const signals = await db
    .from("scanned_signals")
    .select(
      "id, grade, direction, instrument, status, confidence_score, max_r, atr, entry_price, stop_loss, detected_at, p_fill_prior, p_win_prior, ev_prior, prior_sample_n, prior_tier",
    )
    .eq("model_version", ACTIVE_MODEL_VERSION)
    .lte("detected_at", dataAsOf)
    .limit(READ_CAP);
  if (signals.error) throw new Error(`scanned_signals read failed: ${signals.error.message}`);
  const signalRows = (signals.data ?? []) as Array<Record<string, unknown>>;

  const queue = await db
    .from("scan_queue")
    .select("result, status")
    .lte("enqueued_at", dataAsOf)
    .limit(READ_CAP);
  if (queue.error) throw new Error(`scan_queue read failed: ${queue.error.message}`);
  const queueRows = (queue.data ?? []) as Array<{ result: string | null; status: string }>;
  const queueResults = tally(queueRows.map((r) => r.result ?? "unknown"));
  const publishedJobs = queueResults["published"] ?? 0;
  const retentionGap = publishedJobs - signalRows.length;
  if (retentionGap > 0) {
    caveats.push(
      `${retentionGap} published signals have already been hard-deleted by tiered retention; their grade, direction and session distribution is unrecoverable, so signal-level distributions are reconstructed from the shadow cohort, not from scanned_signals.`,
    );
  }


  // 4. Prior calibration. The priors on each signal were stamped AT DETECTION
  //    from the statistics that existed then, so they are point-in-time by
  //    construction and contain no lookahead. Scoring them against the CURRENT
  //    regime_stats would be in-sample leakage and is deliberately not done.
  const outcomeBySignal = new Map<string, ShadowRow>();
  for (const row of resolved) if (row.signal_id) outcomeBySignal.set(row.signal_id, row);
  const stamped = signalRows.filter((s) => s['p_fill_prior'] != null);
  const calibrationPairs = stamped
    .map((s) => {
      const outcome = outcomeBySignal.get(String(s['id']));
      if (!outcome) return null;
      return {
        pFill: Number(s['p_fill_prior']),
        pWin: s['p_win_prior'] == null ? null : Number(s['p_win_prior']),
        filled: outcome.resolved_outcome !== "never_filled" ? 1 : 0,
        won: outcome.ml_target_label === 1 ? 1 : 0,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const calibration = {
    method:
      "Priors are compared against outcomes exactly as they were stamped on the signal at detection time. No join to current statistics — that would score each outcome against a statistic containing it.",
    stamped_signals: stamped.length,
    resolved_pairs: calibrationPairs.length,
    mean_predicted_fill: mean(calibrationPairs.map((p) => p.pFill)),
    observed_fill: wilson(
      calibrationPairs.filter((p) => p.filled === 1).length,
      calibrationPairs.length,
    ),
    mean_predicted_win_if_filled: mean(
      calibrationPairs.filter((p) => p.filled === 1 && p.pWin != null).map((p) => p.pWin as number),
    ),
    observed_win_if_filled: wilson(
      calibrationPairs.filter((p) => p.filled === 1 && p.won === 1).length,
      calibrationPairs.filter((p) => p.filled === 1).length,
    ),
    first_learning_run_at: (firstRun.data?.computed_at as string | undefined) ?? null,
  };
  if (calibrationPairs.length < 30) {
    caveats.push(
      `Only ${calibrationPairs.length} stamped priors have a resolved outcome; calibration is recorded for audit but is not decisive at this sample size.`,
    );
  }

  // 5. Delivery, journal and behaviour counters — all cut off at data_as_of.
  const [hooks, hookErrors, trades, verifiedTrades, telemetry] = await Promise.all([
    db
      .from("webhook_dispatch_log")
      .select("id", { count: "exact", head: true })
      .lte("created_at", dataAsOf),
    db
      .from("webhook_dispatch_log")
      .select("id", { count: "exact", head: true })
      .not("error", "is", null)
      .lte("created_at", dataAsOf),
    db
      .from("executed_trades")
      .select("id", { count: "exact", head: true })
      .lte("created_at", dataAsOf),
    db
      .from("executed_trades")
      .select("id", { count: "exact", head: true })
      .not("actual_entry_price", "is", null)
      .lte("created_at", dataAsOf),
    db
      .from("signal_user_telemetry")
      .select("id", { count: "exact", head: true })
      .lte("created_at", dataAsOf),
  ]);
  if ((trades.count ?? 0) > 0 && (verifiedTrades.count ?? 0) === 0) {
    caveats.push(
      "No logged trade carries a real entry price, so user-reported win rate and R are recorded as behaviour only and are invalid as performance.",
    );
  }

  // 5b. Source coverage: what window each source can actually speak for, and
  //     the retention rule that bounds it. Empty sources report null bounds.
  const [covQueue, covSignals, covShadow, covHooks, covTrades, covTelemetry, covSnapshots] =
    await Promise.all([
      coverage(
        db,
        "scan_queue",
        "enqueued_at",
        dataAsOf,
        "maintain_scan_queue() deletes jobs older than 7 days; cycles before that window are unobservable.",
      ),
      coverage(
        db,
        "scanned_signals",
        "detected_at",
        dataAsOf,
        "purge_expired_signals() hard-deletes expired signals (C 24h, B 36h, A/A+ 48h) unless a trade was taken; deleted rows are unrecoverable.",
      ),
      coverage(
        db,
        "shadow_executions",
        "detected_at",
        dataAsOf,
        "No retention rule: full enrollment history. Rows resolved after data_as_of are counted as unresolved here by design.",
      ),
      coverage(
        db,
        "webhook_dispatch_log",
        "created_at",
        dataAsOf,
        "maintain_scan_queue() deletes dispatch rows older than 14 days.",
      ),
      coverage(
        db,
        "executed_trades",
        "created_at",
        dataAsOf,
        "Users can delete journal rows individually or in bulk from Trade History; counts are a lower bound.",
      ),
      coverage(
        db,
        "signal_user_telemetry",
        "created_at",
        dataAsOf,
        "Append-only, but tied to signals that retention may already have deleted; counts are a lower bound.",
      ),
      coverage(
        db,
        "regime_snapshots",
        "computed_at",
        dataAsOf,
        "180-day retention. Tier-0 volatility boundaries are preserved only from the migration that added them onward; earlier runs have none.",
      ),
    ]);


  const cell = (rows: ShadowRow[], key: (r: ShadowRow) => string) => {
    const groups = new Map<string, ShadowRow[]>();
    for (const r of rows) {
      const k = key(r);
      groups.set(k, (groups.get(k) ?? []).concat(r));
    }
    return [...groups.entries()]
      .map(([k, rs]) => {
        const f = rs.filter((r) => r.resolved_outcome !== "never_filled");
        const w = rs.filter((r) => r.ml_target_label === 1);
        return {
          key: k,
          n: rs.length,
          filled: f.length,
          wins: w.length,
          fill: wilson(f.length, rs.length),
          win_if_filled: wilson(w.length, f.length),
          mean_r: mean(rs.map((r) => Number(r.realized_r))),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  };

  const metrics: Record<string, unknown> = {
    model_version: ACTIVE_MODEL_VERSION,
    model_label: ACTIVE_MODEL_LABEL,
    // The semantic instant of every number below. `captured_at` is only the
    // wall-clock time the document was written.
    data_as_of: dataAsOf,
    data_as_of_note:
      "data_as_of is the pinned learning run's computed_at. Every time-varying source is filtered to rows that existed at or before it, so the document is a point-in-time capture, not a live read.",
    captured_at: new Date().toISOString(),
    pinned_run_id: pinnedRunId,
    pinned_run_at: pinnedRunAt,
    pinned_regime_rows: (pinnedRows.data ?? []).length,
    pinned_tier0_rows: pinnedTier0,
    source_coverage: {
      scan_queue: covQueue,
      scanned_signals: covSignals,
      shadow_executions: covShadow,
      webhook_dispatch_log: covHooks,
      executed_trades: covTrades,
      signal_user_telemetry: covTelemetry,
      regime_snapshots: covSnapshots,
    },
    shadow_cohort: {
      enrolled: shadowRows.length,
      resolved: resolved.length,
      resolved_after_cutoff_excluded: resolvedAfterCutoff,

      filled: filled.length,
      wins: wins.length,
      losses: resolved.filter((r) => r.resolved_outcome === "loss").length,
      expired: resolved.filter((r) => r.resolved_outcome === "expired").length,
      never_filled: neverFilled.length,
      fill_rate: fillRate,
      win_if_filled: winIfFilled,
      unconditional_win_per_signal: unconditional,
      note:
        "win_if_filled is conditional on the limit being reached and is selection-biased by construction. The engine-level number is unconditional_win_per_signal = fill_rate x win_if_filled.",
      mean_r_all_resolved: mean(resolved.map((r) => Number(r.realized_r))),
      mean_r_filled: mean(filled.map((r) => Number(r.realized_r))),
      miss_distance_atr: {
        p50: quantile(neverFilled.map((r) => Number(r.miss_distance_atr)), 0.5),
        p90: quantile(neverFilled.map((r) => Number(r.miss_distance_atr)), 0.9),
      },
    },
    geometry: {
      max_r: {
        p50: quantile(resolved.map((r) => Number(r.max_r)), 0.5),
        p90: quantile(resolved.map((r) => Number(r.max_r)), 0.9),
        max: quantile(resolved.map((r) => Number(r.max_r)), 1),
      },
      stop_distance_in_atr: {
        p50: quantile(
          resolved
            .filter((r) => Number(r.atr) > 0)
            .map((r) => Number(r.risk_price) / Number(r.atr)),
          0.5,
        ),
        p90: quantile(
          resolved
            .filter((r) => Number(r.atr) > 0)
            .map((r) => Number(r.risk_price) / Number(r.atr)),
          0.9,
        ),
      },
    },
    cells: {
      by_instrument: cell(resolved, (r) => r.instrument),
      by_grade: cell(resolved, (r) => r.grade),
      by_direction: cell(resolved, (r) => r.direction),
      by_session: cell(resolved, (r) => r.trading_session ?? "unknown"),
      by_instrument_direction: cell(resolved, (r) => `${r.instrument}|${r.direction}`),
    },
    signals_surviving_retention: {
      total: signalRows.length,
      active: signalRows.filter((s) => s['status'] === "active").length,
      by_grade: tally(signalRows.map((s) => String(s['grade']))),
      by_direction: tally(signalRows.map((s) => String(s['direction']))),
      by_instrument: tally(signalRows.map((s) => String(s['instrument']))),
      mean_confidence: mean(signalRows.map((s) => Number(s['confidence_score']))),
      published_jobs_all_time: publishedJobs,
      hard_deleted_by_retention: Math.max(0, retentionGap),
    },
    queue_health: {
      jobs: queueRows.length,
      by_result: queueResults,
      by_status: tally(queueRows.map((r) => r.status)),
      unobserved_cycles: (queueResults["failed"] ?? 0) + (queueResults["stale"] ?? 0),
    },
    delivery: {
      webhook_dispatches: hooks.count ?? 0,
      webhook_errors: hookErrors.count ?? 0,
    },
    journal_behaviour_only: {
      logged_trades: trades.count ?? 0,
      with_real_prices: verifiedTrades.count ?? 0,
      telemetry_events: telemetry.count ?? 0,
    },
    prior_calibration: calibration,
    caveats,
  };

  // 6. Store. The unique (pinned_run_id, kind) makes a repeat call a no-op
  //    rather than a second competing "official" baseline.
  const insert = await db
    .from("baseline_snapshots")
    .insert({
      kind,
      model_version: ACTIVE_MODEL_VERSION,
      pinned_run_id: pinnedRunId,
      metrics,
    })
    .select("id")
    .maybeSingle();

  if (insert.error) {
    if ((insert.error as { code?: string }).code === "23505") {
      return {
        captured: false,
        reason: `A ${kind} baseline is already recorded for learning run ${pinnedRunId}; the stored document is authoritative and was not overwritten.`,
        pinnedRunId,
        metrics,
      };
    }
    throw new Error(`baseline_snapshots write failed: ${insert.error.message}`);
  }

  return { captured: true, pinnedRunId, metrics };
}
