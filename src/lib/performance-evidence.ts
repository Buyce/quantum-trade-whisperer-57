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
}
