/**
 * Model-explain layer for the Intelligence Panel — pure, browser-safe maths.
 *
 * HONESTY CONTRACT: there is no trained coefficient model behind the priors.
 * The engine is a hierarchical Beta-Binomial shrinkage estimator, so the only
 * truthful "explanation" is (a) the shrinkage ladder that produced the number
 * and (b) measured associations between regime features and outcomes in the
 * replay dataset. Nothing here invents feature importances, gradients, or
 * SHAP-style attributions, and nothing here is allowed to influence grading.
 *
 * Everything is derived from `regime_stats` rows written by the hourly
 * recompute. When a tier has no rows, the corresponding step or feature is
 * omitted rather than filled with a placeholder.
 */
import { volBucketOf, type RegimeQuery, type RegimeStatRow, type VolBucket } from "./regime";

/** Prior strength k used by recompute_regime_stats(); mirrored for weight maths. */
export const PRIOR_STRENGTH = 30;

export interface ExplainStep {
  tier: number;
  label: string;
  regimeKey: string;
  nTotal: number;
  nFilled: number;
  wins: number;
  pFillRaw: number | null;
  pWinRaw: number | null;
  pFillShrunk: number;
  pWinShrunk: number;
  /** Share of the fill estimate carried by this bucket's own data: n / (n + k). */
  ownWeightFill: number;
  /** Share of the win estimate carried by this bucket's own fills: f / (f + k). */
  ownWeightWin: number;
  /** True for the tier that actually answered for this signal. */
  matched: boolean;
}

export interface FeatureInfluence {
  /** Feature family: what was varied while everything else was held fixed. */
  feature: string;
  /** The signal's own value for that feature. */
  value: string;
  /** What it is compared against. */
  baseline: string;
  /** Percentage-point difference in win-if-filled rate vs the baseline. */
  deltaWinPp: number | null;
  /** Percentage-point difference in fill rate vs the baseline. */
  deltaFillPp: number | null;
  /** Resolved samples behind this feature slice. */
  nTotal: number;
  /** Filled samples behind the win delta. */
  nFilled: number;
}

export interface RegimeExplanation {
  bucket: VolBucket;
  matchedTier: number;
  ladder: ExplainStep[];
  features: FeatureInfluence[];
  /** Where the matched estimate's weight mostly sits. */
  leansOn: "own-bucket" | "parent-regimes";
}

interface Agg {
  n: number;
  f: number;
  w: number;
}

function agg(rows: RegimeStatRow[]): Agg {
  return rows.reduce<Agg>(
    (acc, r) => ({
      n: acc.n + Number(r.n_total ?? 0),
      f: acc.f + Number(r.n_filled ?? 0),
      w: acc.w + Number(r.wins ?? 0),
    }),
    { n: 0, f: 0, w: 0 },
  );
}

const rate = (num: number, den: number) => (den > 0 ? num / den : null);

function pp(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return Number(((a - b) * 100).toFixed(1));
}

function step(row: RegimeStatRow, label: string, matched: boolean): ExplainStep {
  const n = Number(row.n_total ?? 0);
  const f = Number(row.n_filled ?? 0);
  return {
    tier: row.tier,
    label,
    regimeKey: row.regime_key,
    nTotal: n,
    nFilled: f,
    wins: Number(row.wins ?? 0),
    pFillRaw: row.p_fill_raw == null ? rate(f, n) : Number(row.p_fill_raw),
    pWinRaw: row.p_win_raw == null ? rate(Number(row.wins ?? 0), f) : Number(row.p_win_raw),
    pFillShrunk: Number(row.p_fill_shrunk),
    pWinShrunk: Number(row.p_win_shrunk),
    ownWeightFill: n / (n + PRIOR_STRENGTH),
    ownWeightWin: f / (f + PRIOR_STRENGTH),
    matched,
  };
}

/**
 * Rebuild the exact chain that produced a signal's prior, plus the measured
 * effect of each regime feature. Returns null when the statistics table has no
 * global row (i.e. nothing has been learned yet).
 */
export function explainRegime(
  rows: RegimeStatRow[],
  query: RegimeQuery,
): RegimeExplanation | null {
  const global = rows.find((r) => r.tier === 1);
  if (!global) return null;

  const boundaries = rows.find((r) => r.tier === 0 && r.instrument === query.instrument);
  const bucket = volBucketOf(
    query.volatilityIndex,
    boundaries?.vol_t1 ?? null,
    boundaries?.vol_t2 ?? null,
  );

  const tier2Key = `${query.instrument}|${query.direction}`;
  const tier3Key = `${tier2Key}|${query.session}|${bucket}`;
  const tier2 = rows.find((r) => r.tier === 2 && r.regime_key === tier2Key) ?? null;
  const tier3 = rows.find((r) => r.tier === 3 && r.regime_key === tier3Key) ?? null;
  const matchedTier = tier3 ? 3 : tier2 ? 2 : 1;

  const ladder: ExplainStep[] = [step(global, "All instruments (baseline)", matchedTier === 1)];
  if (tier2) ladder.push(step(tier2, `${query.instrument} ${query.direction}`, matchedTier === 2));
  if (tier3) ladder.push(step(tier3, "This exact regime", matchedTier === 3));

  const matched = ladder[ladder.length - 1]!;

  // --- Measured feature associations, each holding the coarser slice fixed. ---
  const features: FeatureInfluence[] = [];
  const gFill = rate(Number(global.n_filled ?? 0), Number(global.n_total ?? 0));
  const gWin = rate(Number(global.wins ?? 0), Number(global.n_filled ?? 0));

  // Instrument: all directions for this instrument vs every instrument.
  const instRows = rows.filter((r) => r.tier === 2 && r.instrument === query.instrument);
  const inst = agg(instRows);
  if (inst.n > 0) {
    features.push({
      feature: "Instrument",
      value: query.instrument,
      baseline: "all instruments",
      deltaFillPp: pp(rate(inst.f, inst.n), gFill),
      deltaWinPp: pp(rate(inst.w, inst.f), gWin),
      nTotal: inst.n,
      nFilled: inst.f,
    });
  }

  // Direction: this instrument + direction vs the instrument across directions.
  if (tier2) {
    const t2 = agg([tier2]);
    features.push({
      feature: "Direction",
      value: query.direction,
      baseline: `${query.instrument} both directions`,
      deltaFillPp: pp(rate(t2.f, t2.n), rate(inst.f, inst.n)),
      deltaWinPp: pp(rate(t2.w, t2.f), rate(inst.w, inst.f)),
      nTotal: t2.n,
      nFilled: t2.f,
    });

    const siblings = rows.filter((r) => r.tier === 3 && r.regime_key.startsWith(`${tier2Key}|`));
    const base = agg(siblings.length ? siblings : [tier2]);

    // Session: same instrument + direction, this session, every volatility bucket.
    const sessionRows = siblings.filter((r) => r.session === query.session);
    const sess = agg(sessionRows);
    if (sess.n > 0) {
      features.push({
        feature: "Session",
        value: query.session,
        baseline: `${query.instrument} ${query.direction} all sessions`,
        deltaFillPp: pp(rate(sess.f, sess.n), rate(base.f, base.n)),
        deltaWinPp: pp(rate(sess.w, sess.f), rate(base.w, base.f)),
        nTotal: sess.n,
        nFilled: sess.f,
      });
    }

    // Volatility tercile: same instrument + direction, this bucket, every session.
    const volRows = siblings.filter((r) => r.vol_bucket === bucket);
    const vol = agg(volRows);
    if (bucket !== "unknown" && vol.n > 0) {
      features.push({
        feature: "Volatility",
        value: `${bucket} tercile`,
        baseline: `${query.instrument} ${query.direction} all volatility`,
        deltaFillPp: pp(rate(vol.f, vol.n), rate(base.f, base.n)),
        deltaWinPp: pp(rate(vol.w, vol.f), rate(base.w, base.f)),
        nTotal: vol.n,
        nFilled: vol.f,
      });
    }
  }

  features.sort((a, b) => Math.abs(b.deltaWinPp ?? 0) - Math.abs(a.deltaWinPp ?? 0));

  return {
    bucket,
    matchedTier,
    ladder,
    features,
    leansOn: matched.ownWeightWin >= 0.5 ? "own-bucket" : "parent-regimes",
  };
}
