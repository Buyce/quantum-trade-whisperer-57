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

/** `suspended` scans nothing; `disabled` scans nothing. */
export function mayScan(stage: InstrumentStage): boolean {
  return RANK[stage] >= RANK.data_validation;
}

/** Writing to `scanned_signals`, and therefore the feed and every alert channel. */
export function mayPublish(stage: InstrumentStage): boolean {
  return RANK[stage] >= RANK.signals_only;
}

/** Automatic order enqueue AND the final pre-send revalidation. */
export function mayExecute(stage: InstrumentStage): boolean {
  return stage === "execution_approved";
}

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
