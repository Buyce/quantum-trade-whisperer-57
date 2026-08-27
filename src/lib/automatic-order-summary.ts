/** Source-separated automatic-order accounting for the Performance screen. */

export interface AutomaticOrderDeliverySummaryRow {
  id?: number | null;
  state: string | null;
  dry_run: boolean | null;
  submitted_at: string | null;
  broker_retcode_string: string | null;
}

export interface AutomaticOrderEvidenceSummaryRow {
  delivery_id?: number | null;
  state: string | null;
  r_vs_plan: number | string | null;
  r_vs_actual_risk: number | string | null;
}

export interface AutomaticOrderRStats {
  wins: number;
  losses: number;
  breakeven: number;
  unavailable: number;
}

export interface AutomaticOrderSummary {
  deliveryRows: number;
  dryRuns: number;
  blockedBeforeBroker: number;
  submittedToBroker: number;
  /**
   * Orders the broker ACCEPTED as pending and has not turned into a position.
   * They are live at the broker, waiting for price — not fills, and never counted
   * as trades.
   */
  restingAtBroker: number;
  brokerOpen: number;
  brokerClosed: number;
  awaitingEvidence: number;
  reconciliationLastSuccessAt: string | null;
  reconciliationLastErrorAt: string | null;
  reconciliationLastError: string | null;
  closedPlan: AutomaticOrderRStats;
  closedActualRisk: AutomaticOrderRStats;
}

const SUBMITTED_STATES = new Set(["sent", "acknowledged", "unknown"]);
const BLOCKED_STATES = new Set(["rejected", "failed"]);

function finite(value: number | string | null): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyRStats(): AutomaticOrderRStats {
  return { wins: 0, losses: 0, breakeven: 0, unavailable: 0 };
}

function addR(stats: AutomaticOrderRStats, value: number | string | null) {
  const r = finite(value);
  if (r === null) stats.unavailable += 1;
  else if (r > 0) stats.wins += 1;
  else if (r < 0) stats.losses += 1;
  else stats.breakeven += 1;
}

export function automaticOrderDeliveryReachedBroker(
  row: AutomaticOrderDeliverySummaryRow,
): boolean {
  if (row.dry_run === true) return false;
  return Boolean(
    row.submitted_at !== null ||
    row.broker_retcode_string !== null ||
    (row.state !== null && SUBMITTED_STATES.has(row.state)),
  );
}

export function summarizeAutomaticOrders(
  deliveries: AutomaticOrderDeliverySummaryRow[],
  evidence: AutomaticOrderEvidenceSummaryRow[],
): AutomaticOrderSummary {
  const closedPlan = emptyRStats();
  const closedActualRisk = emptyRStats();
  let brokerOpen = 0;
  let brokerClosed = 0;

  for (const row of evidence) {
    if (row.state === "open") brokerOpen += 1;
    if (row.state === "closed") {
      brokerClosed += 1;
      addR(closedPlan, row.r_vs_plan);
      addR(closedActualRisk, row.r_vs_actual_risk);
    }
  }

  const evidenceDeliveryIds = new Set(
    evidence
      .map((row) => row.delivery_id)
      .filter((id): id is number => typeof id === "number" && Number.isFinite(id)),
  );

  return {
    deliveryRows: deliveries.length,
    dryRuns: deliveries.filter((row) => row.dry_run === true).length,
    blockedBeforeBroker: deliveries.filter(
      (row) =>
        row.dry_run !== true &&
        row.state !== null &&
        BLOCKED_STATES.has(row.state) &&
        !automaticOrderDeliveryReachedBroker(row),
    ).length,
    submittedToBroker: deliveries.filter(automaticOrderDeliveryReachedBroker).length,
    restingAtBroker: deliveries.filter(
      (row) =>
        row.dry_run !== true &&
        row.state === "acknowledged" &&
        !(typeof row.id === "number" && evidenceDeliveryIds.has(row.id)),
    ).length,
    brokerOpen,
    brokerClosed,
    awaitingEvidence: deliveries.filter(
      (row) =>
        automaticOrderDeliveryReachedBroker(row) &&
        !(typeof row.id === "number" && evidenceDeliveryIds.has(row.id)),
    ).length,
    reconciliationLastSuccessAt: null,
    reconciliationLastErrorAt: null,
    reconciliationLastError: null,
    closedPlan,
    closedActualRisk,
  };
}
