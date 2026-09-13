/**
 * Training-dataset catalogue — the one description of what can leave the
 * database for model training and team analysis.
 *
 * Every entry names a real table, the timestamp column the window is cut on,
 * the provenance class of its numbers (see `docs/DATA-PROVENANCE.md`) and the
 * columns that are never exported because they identify an account or a
 * delivery. Nothing here fabricates rows: an empty window exports zero rows.
 *
 * This catalogue and the SQL function `public.read_training_dataset` must stay
 * in step; `src/lib/datasets/__tests__/catalog.test.ts` asserts that they do.
 */

export type ProvenanceClass =
  | "broker-derived"
  | "engine-derived"
  | "broker evidence"
  | "replay-derived";

export interface DatasetSpec {
  /** Stable identifier used by the export UI, the server function and MCP. */
  id: string;
  /** Human label for the Admin panel and the data dictionary. */
  label: string;
  /** Physical table the rows come from. */
  table: string;
  /** Column the `since` / `until` window is applied to. */
  timeColumn: string;
  /** Where the numbers in this dataset come from. */
  provenance: ProvenanceClass;
  /** One sentence: what one row is. */
  rowMeaning: string;
  /** Columns withheld from every export because they identify an account. */
  withheldColumns: string[];
  /** What this dataset must not be read as. */
  nonGuarantee: string;
}

export const DATASETS: readonly DatasetSpec[] = [
  {
    id: "signals",
    label: "Published setups",
    table: "scanned_signals",
    timeColumn: "detected_at",
    provenance: "engine-derived",
    rowMeaning: "One published scanner setup, with its geometry, grade and prior at publication.",
    withheldColumns: [],
    nonGuarantee: "A published setup is not a trade and not a forecast.",
  },
  {
    id: "shadow_replay",
    label: "Shadow replay outcomes",
    table: "shadow_executions",
    timeColumn: "detected_at",
    provenance: "replay-derived",
    rowMeaning:
      "One deterministic replay of a setup over stored candles; no order was ever placed.",
    withheldColumns: [],
    nonGuarantee: "Replay outcomes are in-sample measurements, never live results.",
  },
  {
    id: "research_candidates",
    label: "Research candidates",
    table: "research_candidates",
    timeColumn: "detected_at",
    provenance: "engine-derived",
    rowMeaning:
      "One structure captured before publication, with the gate record that accepted or rejected it.",
    withheldColumns: [],
    nonGuarantee: "A candidate is not a published signal and carries no delivery claim.",
  },
  {
    id: "broker_trades",
    label: "Broker-verified trades",
    table: "broker_trade_evidence",
    timeColumn: "first_observed_at",
    provenance: "broker evidence",
    rowMeaning: "One broker-reported trade positively associated with a P-Trades setup or account.",
    withheldColumns: [
      "user_id",
      "account_id",
      "metaapi_account_id",
      "client_id",
      "magic",
      "broker_order_id",
      "broker_position_id",
      "delivery_id",
      "deals",
      "research_account_ref",
    ],
    nonGuarantee: "Demo-account evidence is not a live money track record.",
  },
  {
    id: "payoff_stats",
    label: "Full-payoff expected R",
    table: "payoff_stats",
    timeColumn: "computed_as_of",
    provenance: "replay-derived",
    rowMeaning:
      "One cohort's expected R over the full payoff distribution, with sample size and confidence interval.",
    withheldColumns: [],
    nonGuarantee: "Expected R is a descriptive estimate, not a promised return.",
  },
  {
    id: "regime_stats",
    label: "Regime fill and win rates",
    table: "regime_stats",
    timeColumn: "computed_at",
    provenance: "replay-derived",
    rowMeaning: "One regime bucket's shrunk fill and TP1-if-filled rates.",
    withheldColumns: [],
    nonGuarantee: "Shrunk rates are in-sample summaries, not probabilities of future outcomes.",
  },
  {
    id: "filter_lift_stats",
    label: "Filter lift",
    table: "filter_lift_stats",
    timeColumn: "computed_as_of",
    provenance: "replay-derived",
    rowMeaning: "One gate's counterfactual mean R over the setups it rejected.",
    withheldColumns: [],
    nonGuarantee: "Counterfactual lift only exists for gates that reject after geometry is known.",
  },
  {
    id: "spread_stats",
    label: "Spread and quote quality",
    table: "instrument_spread_stats",
    timeColumn: "calculated_at",
    provenance: "broker-derived",
    rowMeaning: "One instrument/session spread distribution with sample coverage and missingness.",
    withheldColumns: [],
    nonGuarantee: "Spread norms describe sampled quotes, not guaranteed execution cost.",
  },
] as const;

export function datasetById(id: string): DatasetSpec | undefined {
  return DATASETS.find((d) => d.id === id);
}

export const DATASET_IDS = DATASETS.map((d) => d.id);

/** Hard limits shared by the export UI, the server function and MCP. */
export const MAX_DATASET_PAGE = 5_000;
export const DEFAULT_DATASET_PAGE = 500;
