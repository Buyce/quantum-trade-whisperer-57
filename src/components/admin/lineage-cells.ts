/**
 * Pure cell builders for the candidate lineage table.
 *
 * The lineage RPC omits keys whose value is absent, so a field can arrive as
 * `undefined` rather than `null`. Every numeric read therefore goes through
 * `fixed2`, which renders nothing for null, undefined or non-finite values and
 * never defaults a missing measurement to zero.
 */
import type { CandidateLineageRow } from "@/lib/learning/candidates";

/** Formats a real number to 2dp; returns null when there is nothing to show. */
export function fixed2(value: unknown): string | null {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

export function replayOutcome(row: CandidateLineageRow): string {
  if (row.research_window_status === "outside_replay_window") {
    return "outside replay window — history no longer available";
  }
  if (!row.shadow_status) return "not enrolled yet";
  if (row.shadow_outcome) {
    const r = fixed2(row.shadow_realized_r);
    return `${row.shadow_outcome}${r === null ? "" : ` · ${r}R (replay)`}`;
  }
  return `${row.shadow_status} — still replaying`;
}

export function brokerCell(row: CandidateLineageRow): string {
  if (!row.published_signal_id) return "never sent — no broker order";
  if (!row.enqueue_decision) return "published, no auto-order attempt";
  if (!row.broker_state)
    return `auto-order ${row.enqueue_decision}${row.enqueue_reason ? `: ${row.enqueue_reason}` : ""}`;
  const net = fixed2(row.broker_net_profit);
  const money = net === null ? "" : ` · ${net} ${row.broker_currency ?? ""}`.trimEnd();
  const rVsPlan = fixed2(row.broker_r_vs_plan);
  const r = rVsPlan === null ? "" : ` · ${rVsPlan}R vs plan`;
  return `broker ${row.broker_state}${money}${r}`;
}
