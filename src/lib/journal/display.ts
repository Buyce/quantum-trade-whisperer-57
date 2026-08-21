/**
 * Single presentation helper for journal R, shared by the web terminal, CSV/JSON
 * export and MCP.
 *
 * Two hard rules:
 *  - a missing R renders as an explicit unavailable marker, never as "0.00R";
 *  - every rendered figure carries its basis, and frozen legacy values are
 *    labelled as legacy mixed-basis data rather than silently shown as canonical.
 */
import { selectR, type RBasis } from "./r-math";

export const R_UNAVAILABLE = "—";

export type RProvenance = "canonical" | "legacy" | "unavailable";

export interface JournalRRow {
  outcome: string;
  r_vs_plan?: number | null;
  r_vs_actual_risk?: number | null;
  r_availability?: string | null;
  stop_provenance?: string | null;
  realized_r_multiple?: number | null;
  derived_r?: number | null;
}

export interface JournalRView {
  value: number | null;
  provenance: RProvenance;
  basis: RBasis | null;
  /** Short label safe to render next to the number. */
  label: string;
  /** Why there is no number, when there isn't one. */
  reason: string | null;
}

export const BASIS_LABELS: Record<RBasis, string> = {
  plan: "R vs plan",
  actual_risk: "R vs actual risk",
};

/**
 * Resolves what to show for one trade under an explicitly requested basis.
 * Legacy rows are surfaced only when no canonical value exists, and are labelled.
 */
export function journalRView(row: JournalRRow, basis: RBasis): JournalRView {
  const canonical = selectR(
    { r_vs_plan: row.r_vs_plan ?? null, r_vs_actual_risk: row.r_vs_actual_risk ?? null },
    basis,
  );
  if (canonical !== null) {
    const suffix = row.stop_provenance === "planned_stop_fallback" ? " (planned stop)" : "";
    return {
      value: canonical,
      provenance: "canonical",
      basis,
      label: BASIS_LABELS[basis] + suffix,
      reason: null,
    };
  }

  const legacy = row.derived_r ?? row.realized_r_multiple ?? null;
  if (legacy != null) {
    return {
      value: Number(legacy),
      provenance: "legacy",
      basis: null,
      label: "Legacy R (mixed basis)",
      reason: null,
    };
  }

  return {
    value: null,
    provenance: "unavailable",
    basis: null,
    label: BASIS_LABELS[basis],
    reason: reasonFor(row),
  };
}

function reasonFor(row: JournalRRow): string {
  switch (row.r_availability) {
    case "unavailable_open":
      return "Trade is still open.";
    case "unavailable_no_prices":
      return "No actual entry/exit prices recorded.";
    case "unavailable_no_plan":
      return "No plan or stop reference recorded.";
    case "unavailable_zero_risk":
      return "Risk distance is zero, so R is undefined.";
    case "plan_only":
      return "Only R vs plan is available for this trade.";
    case "actual_risk_only":
      return "Only R vs actual risk is available for this trade.";
    default:
      return row.outcome === "open" ? "Trade is still open." : "R is unavailable for this trade.";
  }
}

/** Renders "1.85R", or the unavailable marker. Never prints a false 0.00R. */
export function formatJournalR(view: JournalRView): string {
  return view.value === null ? R_UNAVAILABLE : `${view.value.toFixed(2)}R`;
}
