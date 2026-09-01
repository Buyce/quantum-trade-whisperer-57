import type { Grade } from "@/lib/db-types";

export type PerformanceEvidenceSource = "customer" | "benchmark";

/**
 * Sanitized broker-evidence DTO for Performance. It intentionally contains no
 * user, account, broker login, MetaApi, client, order or position identifier.
 */
export interface PerformanceEvidenceRow {
  /** Response-local render key; never a database, account or broker id. */
  key: string;
  source: PerformanceEvidenceSource;
  instrument: string;
  grade: Grade | "Unknown";
  detectedAt: string;
  hour: number;
  dayOfWeek: number;
  session: string;
  rVsPlan: number | null;
  rVsActualRisk: number | null;
  /**
   * BROKER-REPORTED money for this trade, in the broker's own profit currency.
   * These are the figures the broker's deals carry — never a plan price, never a
   * reconstruction. NULL means the broker did not report it.
   */
  volume: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  grossProfit: number | null;
  commission: number | null;
  swap: number | null;
  /** gross + swap + commission, or null when the broker reported no gross figure. */
  netProfit: number | null;
  currency: string | null;
  /** Broker fill versus the price P-Trades published or submitted, when knowable. */
  slippagePrice: number | null;
  slippageAvailability: string | null;
  /**
   * Where the grade came from. `recovered_from_enqueue_decision` marks a trade
   * whose setup row was purged and whose grade was proved from the decision log;
   * such a row has a real grade but no plan geometry.
   */
  gradeSource: "delivery" | "recovered_from_enqueue_decision" | null;
}
