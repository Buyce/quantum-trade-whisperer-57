/**
 * Detection provenance (R7 + R8) — WHICH BAR, from WHICH provider symbol.
 *
 * The provenance columns on `model_observations` and `research_candidates` have
 * existed since Phase A2A, and nothing wrote them: 2,732 observation rows carried
 * NULL candle policy, NULL provider symbol and NULL as-of timestamps. A row like
 * that cannot be compared with anything, because the two facts that decide
 * comparability — which candle finality produced it, and which broker symbol the
 * numbers came from — were simply not recorded.
 *
 * This module is the single place a detection's provenance is assembled. It is
 * pure: it takes what the pipeline already has in hand (the candle series it
 * fetched, the mapping it resolved) and returns the exact column values to store.
 *
 * Hard rules:
 *  - Nothing is inferred. A timeframe with no candles yields a NULL as-of, never
 *    "now" and never the previous timeframe's bar time.
 *  - The as-of timestamp is the OPEN TIME of the last bar read, because under the
 *    Wave 0 forming-candle policy that bar is still incomplete; calling it a close
 *    time would be a false statement about the data.
 *  - Legacy rows are never backfilled. A NULL policy version means "written before
 *    provenance existed", which is information, and inventing a version for those
 *    rows would destroy the only marker separating them from Wave 1 cohorts.
 */
import { candlePolicy, LIVE_CANDLE_POLICY_VERSION, type CandleFinality } from "./candle-policy";

export interface ProvenanceCandleInput {
  /** Timeframe label, e.g. "H4". */
  timeframe: string;
  /** Open time of the last bar that was read, or null when none was read. */
  lastBarTime: string | null;
  /** How many bars were read for this timeframe. */
  bars: number;
}

export interface DetectionProvenance {
  candlePolicyVersion: number;
  candlePolicyName: string;
  candleFinality: CandleFinality;
  /** Newest bar time across every timeframe read; null when nothing was read. */
  candleAsOf: string | null;
  /** Per-timeframe as-of, in the order the timeframes were fetched. */
  asOfByTimeframe: ProvenanceCandleInput[];
  /** Provider symbol actually sent to the data provider; null when refused. */
  providerSymbol: string | null;
  /** `provider:symbol` label describing where candles came from. */
  candleSource: string | null;
  /** When the symbol mapping was last verified. */
  mappingVerifiedAt: string | null;
  /** Provider source time of the quote used, when a quote was used. */
  quoteAsOf: string | null;
  /** When the broker specification behind the numbers was fetched. */
  specAsOf: string | null;
}

/** Provenance column names shared by `model_observations` and `research_candidates`. */
export interface ProvenanceColumns {
  candle_policy_version: number | null;
  candle_as_of: string | null;
  candle_source: string | null;
  provider_symbol: string | null;
  mapping_verified_at: string | null;
  quote_as_of: string | null;
  spec_as_of: string | null;
}

function newest(times: Array<string | null>): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const t of times) {
    if (!t) continue;
    const ms = new Date(t).getTime();
    if (!Number.isFinite(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = t;
    }
  }
  return best;
}

/**
 * Assemble the provenance of one detection.
 *
 * `policyVersion` defaults to the live Wave 0 policy. A research model reading
 * closed candles must pass its own version explicitly, so a forming-candle row
 * and a closed-candle row can never be pooled by accident.
 */
export function buildDetectionProvenance(args: {
  candles: ProvenanceCandleInput[];
  providerSymbol: string | null;
  provider?: string;
  mappingVerifiedAt?: string | null;
  quoteAsOf?: string | null;
  specAsOf?: string | null;
  policyVersion?: number;
}): DetectionProvenance {
  const version = args.policyVersion ?? LIVE_CANDLE_POLICY_VERSION;
  const policy = candlePolicy(version);
  if (!policy) {
    throw new Error(`unknown candle policy version ${version}`);
  }
  const provider = args.provider ?? "metaapi";
  return {
    candlePolicyVersion: policy.version,
    candlePolicyName: policy.name,
    candleFinality: policy.finality,
    candleAsOf: newest(args.candles.map((c) => c.lastBarTime)),
    asOfByTimeframe: args.candles,
    providerSymbol: args.providerSymbol,
    candleSource: args.providerSymbol ? `${provider}:${args.providerSymbol}` : null,
    mappingVerifiedAt: args.mappingVerifiedAt ?? null,
    quoteAsOf: args.quoteAsOf ?? null,
    specAsOf: args.specAsOf ?? null,
  };
}

/**
 * The database columns for a provenance record. A missing record yields all
 * NULLs — the honest representation of "this row was written without provenance"
 * rather than a fabricated default.
 */
export function provenanceColumns(p: DetectionProvenance | null | undefined): ProvenanceColumns {
  if (!p) {
    return {
      candle_policy_version: null,
      candle_as_of: null,
      candle_source: null,
      provider_symbol: null,
      mapping_verified_at: null,
      quote_as_of: null,
      spec_as_of: null,
    };
  }
  return {
    candle_policy_version: p.candlePolicyVersion,
    candle_as_of: p.candleAsOf,
    candle_source: p.candleSource,
    provider_symbol: p.providerSymbol,
    mapping_verified_at: p.mappingVerifiedAt,
    quote_as_of: p.quoteAsOf,
    spec_as_of: p.specAsOf,
  };
}

/**
 * True when two provenance records may be pooled into one statistic. Different
 * candle finality means different data-generating processes, so the answer is no
 * even when everything else matches.
 */
export function comparableProvenance(
  a: DetectionProvenance | null,
  b: DetectionProvenance | null,
): boolean {
  if (!a || !b) return false;
  return a.candlePolicyVersion === b.candlePolicyVersion && a.candleFinality === b.candleFinality;
}
