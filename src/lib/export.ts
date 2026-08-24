/**
 * Client-side export helpers. Everything here runs synchronously in the
 * browser from data already present in React Query state — no server routes,
 * no schema access, no scanner involvement.
 */
import { contextOf, type SignalRow, type TradeHistoryRow } from "./db-types";
import type { RSample } from "./performance";
import type { BrokerOrderView } from "./history/broker-orders";
import { presentSignalBreakdown } from "./scanner/copy";

/** Triggers a browser download for an in-memory blob. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function todayStamp(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds a CSV string with a header row. */
export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join(
    "\r\n",
  );
}

export function downloadJson(filename: string, data: unknown) {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
}

export function downloadCsv(filename: string, csv: string) {
  downloadBlob(filename, new Blob([csv], { type: "text/csv" }));
}

/* ------------------------------- signal feed ------------------------------ */

/** LLM-friendly projection of the signals currently rendered in the feed. */
export function signalsToExportJson(signals: SignalRow[]) {
  return {
    export_type: "ptrades_signal_feed",
    generated_at: new Date().toISOString(),
    count: signals.length,
    notes:
      "Prices are broker quotes. r_multiple is the planned reward-to-risk of the setup. Pillar scores are 0-100 confluence components.",
    signals: signals.map((s) => {
      const ctx = contextOf(s);
      return {
        timestamp: s.detected_at,
        instrument: s.instrument,
        grade: s.grade,
        action: s.direction === "long" ? "LONG" : "SHORT",
        entry: s.entry_price,
        stop_loss: s.stop_loss,
        targets: { tp1: s.tp1, tp2: s.tp2, tp3: s.tp3 },
        target_r_multiples: { tp1: s.tp1_r, tp2: s.tp2_r, tp3: s.tp3_r },
        max_reachable_r: s.max_r,
        r_multiple: s.rr_ratio,
        confidence_score: s.confidence_score,
        pillars: {
          trend: s.p_trend,
          order_block: s.p_order_block,
          momentum: s.p_momentum,
          volatility_expansion: s.p_volatility_expansion,
          pillars_passed: s.pillars_passed,
        },
        bias: { h4: s.h4_bias, h1: s.h1_bias, m15: s.m15_bias },
        pattern_symmetry: s.pattern_symmetry,
        atr: s.atr,
        context: ctx
          ? {
              trading_session: ctx.trading_session,
              volatility_index: ctx.volatility_index,
              hour_utc: ctx.time_of_day,
              day_of_week: ctx.day_of_week,
            }
          : null,
        status: s.status,
        resolved_outcome: s.resolved_outcome,
        resolved_r_multiple: s.resolved_r_multiple,
        qualitative_breakdown: presentSignalBreakdown(s.qualitative_breakdown),
      };
    }),
  };
}

/* ------------------------------- performance ------------------------------ */

export function samplesToCsv(
  samples: RSample[],
  metadata: { provenance: string; rBasis: "plan" | "actual_risk" },
): string {
  return toCsv(
    ["Date", "Instrument", "Grade", "Outcome", "R_Yield", "R_Basis", "Provenance"],
    samples.map((s) => [
      s.detectedAt ? s.detectedAt.slice(0, 10) : "",
      s.instrument,
      s.grade,
      s.outcome === "win" ? "Win" : s.outcome === "loss" ? "Loss" : "Breakeven",
      s.r.toFixed(2),
      metadata.rBasis === "plan" ? "r_vs_plan" : "r_vs_actual_risk",
      metadata.provenance,
    ]),
  );
}

/* ------------------------------ trade history ----------------------------- */

function signalOf(row: TradeHistoryRow): SignalRow | null {
  const s = row.scanned_signals;
  if (!s) return null;
  return Array.isArray(s) ? (s[0] ?? null) : s;
}

const HISTORY_HEADERS = [
  "Logged_At",
  "Detected_At",
  "Instrument",
  "Grade",
  "Direction",
  "Session",
  "Entry",
  "Stop_Loss",
  "TP1",
  "TP2",
  "TP3",
  "Planned_RR",
  "Confidence",
  "Pillar_Trend",
  "Pillar_Order_Block",
  "Pillar_Momentum",
  "Pillar_Volatility",
  "Outcome",
  "R_Yield_Legacy_Mixed_Basis",
  "R_vs_Plan",
  "R_vs_Actual_Risk",
  "R_Availability",
  "Stop_Provenance",
  "Notes",
];

export function historyToCsv(rows: TradeHistoryRow[]): string {
  const data: Array<Array<unknown>> = [];
  for (const row of rows) {
    const s = signalOf(row);
    if (!s) continue;
    const ctx = contextOf(s);
    data.push([
      row.created_at,
      s.detected_at,
      s.instrument,
      s.grade,
      s.direction === "long" ? "LONG" : "SHORT",
      ctx?.trading_session ?? "",
      s.entry_price,
      s.stop_loss,
      s.tp1,
      s.tp2,
      s.tp3 ?? "",
      s.rr_ratio,
      s.confidence_score,
      s.p_trend,
      s.p_order_block,
      s.p_momentum,
      s.p_volatility_expansion,
      row.outcome,
      row.realized_r_multiple ?? "",
      row.r_vs_plan ?? "",
      row.r_vs_actual_risk ?? "",
      row.r_availability ?? "",
      row.stop_provenance ?? "",
      row.notes ?? "",
    ]);
  }
  return toCsv(HISTORY_HEADERS, data);
}

export function historyToExportJson(rows: TradeHistoryRow[]) {
  const trades = [];
  for (const row of rows) {
    const s = signalOf(row);
    if (!s) continue;
    const ctx = contextOf(s);
    trades.push({
      logged_at: row.created_at,
      detected_at: s.detected_at,
      instrument: s.instrument,
      grade: s.grade,
      action: s.direction === "long" ? "LONG" : "SHORT",
      session: ctx?.trading_session ?? null,
      volatility_index: ctx?.volatility_index ?? null,
      hour_utc: ctx?.time_of_day ?? null,
      day_of_week: ctx?.day_of_week ?? null,
      entry: s.entry_price,
      stop_loss: s.stop_loss,
      targets: { tp1: s.tp1, tp2: s.tp2, tp3: s.tp3 },
      target_r_multiples: { tp1: s.tp1_r, tp2: s.tp2_r, tp3: s.tp3_r },
      max_reachable_r: s.max_r,
      planned_r_multiple: s.rr_ratio,
      confidence_score: s.confidence_score,
      pillars: {
        trend: s.p_trend,
        order_block: s.p_order_block,
        momentum: s.p_momentum,
        volatility_expansion: s.p_volatility_expansion,
        pillars_passed: s.pillars_passed,
      },
      bias: { h4: s.h4_bias, h1: s.h1_bias, m15: s.m15_bias },
      outcome: row.outcome,
      // Kept for backward compatibility with existing exports. Frozen legacy
      // value: mixed basis, never averaged with the canonical fields below.
      r_yield: row.realized_r_multiple,
      r_vs_plan: row.r_vs_plan ?? null,
      r_vs_actual_risk: row.r_vs_actual_risk ?? null,
      r_availability: row.r_availability ?? null,
      stop_provenance: row.stop_provenance ?? null,
      r_math_version: row.r_math_version ?? null,
      net_r: row.net_r ?? null,
      verification_level: row.verification_level ?? null,
      costs: {
        commission: row.commission ?? null,
        swap: row.swap ?? null,
        currency: row.cost_currency ?? null,
        unit: row.cost_unit ?? null,
        note: "Costs are money, not price distance. Net R exists only with documented conversion provenance.",
      },
      notes: row.notes,
      qualitative_breakdown: presentSignalBreakdown(s.qualitative_breakdown),
    });
  }
  return {
    export_type: "ptrades_trade_history",
    generated_at: new Date().toISOString(),
    count: trades.length,
    notes:
      "Every trade logged as taken. r_yield is the realized result in multiples of risk; outcome 'open' means no result recorded yet.",
    trades,
  };
}

/* --------------------------- automatic broker orders --------------------------- */

const BROKER_ORDER_HEADERS = [
  "Enqueued_At",
  "Detected_At",
  "Instrument",
  "Grade",
  "Direction",
  "Order_Status",
  "Status_Detail",
  "Dry_Run",
  "Broker_Account_Type",
  "Submitted_Volume",
  "Submitted_Entry",
  "Submitted_Stop",
  "Submitted_Target",
  "Submitted_At",
  "Broker_State",
  "Broker_Entry_Price",
  "Broker_Exit_Price",
  "Broker_Entry_At",
  "Broker_Exit_At",
  "Broker_Gross_Profit",
  "Broker_Commission",
  "Broker_Swap",
  "Profit_Currency",
  "R_vs_Plan",
  "R_vs_Actual_Risk",
  "R_Availability",
  "Stop_Provenance",
];

/**
 * Broker-derived export. Every column is either what P-Trades submitted or what
 * the broker reported back; nothing here is self-reported or estimated, so
 * blanks mean the broker has not supplied that value yet.
 */
export function brokerOrdersToCsv(rows: BrokerOrderView[]): string {
  return toCsv(
    BROKER_ORDER_HEADERS,
    rows.map((row) => [
      row.enqueuedAt,
      row.detectedAt ?? "",
      row.instrument,
      row.grade,
      row.direction ? row.direction.toUpperCase() : "",
      row.status.label,
      row.status.detail ?? "",
      row.dryRun ? "yes" : "no",
      row.accountType ?? "",
      row.submitted.volume ?? "",
      row.submitted.entry ?? "",
      row.submitted.stop ?? "",
      row.submitted.target ?? "",
      row.submitted.at ?? "",
      row.broker?.state ?? "",
      row.broker?.entryPrice ?? "",
      row.broker?.exitPrice ?? "",
      row.broker?.entryAt ?? "",
      row.broker?.exitAt ?? "",
      row.broker?.grossProfit ?? "",
      row.broker?.commission ?? "",
      row.broker?.swap ?? "",
      row.broker?.currency ?? "",
      row.r.basis === "plan" ? (row.r.value ?? "") : "",
      row.r.basis === "actual_risk" ? (row.r.value ?? "") : "",
      row.r.provenance === "unavailable" ? (row.r.reason ?? "unavailable") : "",
      "",
    ]),
  );
}

export function brokerOrdersToExportJson(rows: BrokerOrderView[]) {
  return {
    export_type: "ptrades_automatic_orders",
    generated_at: new Date().toISOString(),
    count: rows.length,
    notes:
      "Broker-derived only. Submitted_* fields are what P-Trades sent to the broker; broker.* fields exist only when real broker deals were matched to the order. Missing values are genuinely unavailable and are never estimated. These rows are valued separately from the self-reported journal.",
    orders: rows.map((row) => ({
      delivery_id: row.deliveryId,
      enqueued_at: row.enqueuedAt,
      detected_at: row.detectedAt,
      instrument: row.instrument,
      grade: row.grade,
      action: row.direction ? row.direction.toUpperCase() : null,
      dry_run: row.dryRun,
      broker_account_type: row.accountType,
      status: row.status,
      submitted: row.submitted,
      plan: row.plan,
      broker: row.broker,
      r: {
        value: row.r.value,
        basis: row.r.basis,
        provenance: row.r.provenance,
        unavailable_reason: row.r.reason,
      },
    })),
  };
}
