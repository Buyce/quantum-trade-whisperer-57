/**
 * Instrument lifecycle — the PURE rules (Phase A / A3).
 *
 * An instrument's stage answers exactly three operational questions:
 *   may it be scanned, may it be published/alerted, may it be executed.
 *
 * The ordering below is the only place those answers live. `lifecycle.server.ts`
 * reads the stage; this module decides what the stage means, so the client feed,
 * the alert fan-out, the enqueue path and the pre-send gate cannot drift.
 *
 * FAIL CLOSED, never "unknown means allowed":
 *   - a Wave 0 symbol with no readable stage falls back to its frozen production
 *     stage, so a lifecycle outage can never silence the live product;
 *   - anything else with no readable stage is treated as `disabled`.
 */
import { WAVE0_SYMBOLS } from "./registry";

export type InstrumentStage =
  "disabled" | "data_validation" | "shadow" | "signals_only" | "execution_approved" | "suspended";

/**
 * Monotonic capability rank. `suspended` is deliberately NOT on this ladder: it
 * is an emergency state that revokes publication and execution regardless of how
 * far the instrument had progressed.
 */
const RANK: Record<InstrumentStage, number> = {
  disabled: 0,
  suspended: 0,
  data_validation: 1,
  shadow: 2,
  signals_only: 3,
  execution_approved: 4,
};

export const STAGE_ORDER: InstrumentStage[] = [
  "disabled",
  "data_validation",
  "shadow",
  "signals_only",
  "execution_approved",
  "suspended",
];

export function isStage(value: unknown): value is InstrumentStage {
  return typeof value === "string" && value in RANK;
}

/** Stage used when the lifecycle table cannot be read at all. */
export function fallbackStage(symbol: string): InstrumentStage {
  return WAVE0_SYMBOLS.includes(symbol) ? "execution_approved" : "disabled";
}

export type StageMap = Record<string, InstrumentStage>;

export function stageOf(symbol: string, stages: StageMap | null | undefined): InstrumentStage {
  const stage = stages?.[symbol];
  return isStage(stage) ? stage : fallbackStage(symbol);
}

/**
 * ---------------------------------------------------------------------------
 * Capability model (Phase A1).
 *
 * Every capability is derived from the SAME rank ladder, so no two gates can
 * disagree about what a stage means. `mayScan` is kept as the historical alias
 * of `mayCollectData` because the scan universe is exactly "who may fetch data".
 *
 *   stage             | collect | evaluate | capture | resolve | publish | alert | execute
 *   ------------------+---------+----------+---------+---------+---------+-------+--------
 *   disabled          |    no   |    no    |   no    |   no    |   no    |  no   |   no
 *   suspended         |    no   |    no    |   no    |   no    |   no    |  no   |   no
 *   data_validation   |   yes   |    no    |   no    |   no    |   no    |  no   |   no
 *   shadow            |   yes   |   yes    |  yes    |  yes    |   no    |  no   |   no
 *   signals_only      |   yes   |   yes    |  yes    |  yes    |  yes    | yes   |   no
 *   execution_approved|   yes   |   yes    |  yes    |  yes    |  yes    | yes   |  yes
 *
 * The `data_validation` / `shadow` split is the reason the granular capabilities
 * exist: `data_validation` proves the DATA (mapping, specification, candles,
 * quotes, conversion) is trustworthy, and running strategy code on data that has
 * not been proven yet would seed the research ledger with rows whose inputs were
 * never validated. Research measurement therefore starts at `shadow`.
 *
 * Every capability must be consulted at its own action boundary. A stage read at
 * the top of a long job is stale by the time the job reaches the broker.
 */

/** Fetch candles/quotes/specs for validation. Does NOT authorise strategy code. */
export function mayCollectData(stage: InstrumentStage): boolean {
  return RANK[stage] >= RANK.data_validation;
}

/**
 * Historical alias of `mayCollectData`: the scan universe is "who may fetch".
 * `suspended` scans nothing; `disabled` scans nothing.
 */
export function mayScan(stage: InstrumentStage): boolean {
  return mayCollectData(stage);
}

/** Run V1/V2/V3 grading on fetched candles. */
export function mayEvaluateStrategy(stage: InstrumentStage): boolean {
  return RANK[stage] >= RANK.shadow;
}

/** Write immutable candidate/evaluation evidence to `research_candidates`. */
export function mayCaptureResearch(stage: InstrumentStage): boolean {
  return RANK[stage] >= RANK.shadow;
}

/** Enrol/track forward outcomes in `shadow_executions`. */
export function mayResolveResearch(stage: InstrumentStage): boolean {
  return RANK[stage] >= RANK.shadow;
}

/** Writing to `scanned_signals`, and therefore the feed. */
export function mayPublish(stage: InstrumentStage): boolean {
  return RANK[stage] >= RANK.signals_only;
}

/** Push/email fan-out. Separate from publication so alerts can be held back. */
export function mayAlert(stage: InstrumentStage): boolean {
  return RANK[stage] >= RANK.signals_only;
}

/** Automatic order enqueue AND the final pre-send revalidation. */
export function mayExecute(stage: InstrumentStage): boolean {
  return stage === "execution_approved";
}

export type LifecycleCapability =
  | "collect_data"
  | "evaluate_strategy"
  | "capture_research"
  | "resolve_research"
  | "publish"
  | "alert"
  | "execute";

const CAPABILITY_GATES: Record<LifecycleCapability, (stage: InstrumentStage) => boolean> = {
  collect_data: mayCollectData,
  evaluate_strategy: mayEvaluateStrategy,
  capture_research: mayCaptureResearch,
  resolve_research: mayResolveResearch,
  publish: mayPublish,
  alert: mayAlert,
  execute: mayExecute,
};

/** Single lookup used by tests and diagnostics to render the whole matrix. */
export function allows(stage: InstrumentStage, capability: LifecycleCapability): boolean {
  return CAPABILITY_GATES[capability](stage);
}

export const LIFECYCLE_CAPABILITIES = Object.keys(CAPABILITY_GATES) as LifecycleCapability[];


/** Machine-readable refusal reason, reused verbatim by every gate. */
export const INSTRUMENT_NOT_APPROVED = "instrument_not_approved" as const;

export function describeStage(stage: InstrumentStage): string {
  switch (stage) {
    case "disabled":
      return "not in service";
    case "data_validation":
      return "data validation — measured only, never published";
    case "shadow":
      return "shadow research — measured only, never published";
    case "signals_only":
      return "signals only — published, never auto-executed";
    case "execution_approved":
      return "approved for automatic execution";
    case "suspended":
      return "suspended — publication and execution revoked";
  }
}
