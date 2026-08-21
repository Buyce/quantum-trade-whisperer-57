/**
 * Whole-UTC-day clustering.
 *
 * The dependence unit for P-Trades is the whole UTC calendar day of
 * `signal_detected_at`: plans detected on one day share regime, news flow and
 * often overlap in time, so per-observation independence is invalid. Every
 * observation inside a selected day is preserved as a block — never subsampled.
 */

export interface ClusterableObservation {
  /** Stable tie-break identity. */
  id: string;
  /** ISO timestamp used for the cluster key. */
  detectedAt: string;
}

export interface DayCluster<T extends ClusterableObservation> {
  /** UTC calendar day, "YYYY-MM-DD". */
  day: string;
  rows: T[];
}

/** UTC calendar-day key. Local time never participates. */
export function utcDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid timestamp: ${iso}`);
  return d.toISOString().slice(0, 10);
}

/**
 * Deterministic total order over observations: `detectedAt`, then `id`. Every
 * consumer sorts through this so bootstrap resampling and summation are
 * reproducible byte-for-byte regardless of query row order.
 */
export function stableOrder<T extends ClusterableObservation>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.detectedAt < b.detectedAt) return -1;
    if (a.detectedAt > b.detectedAt) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

/** Groups into day clusters, both cluster list and rows in stable order. */
export function buildDayClusters<T extends ClusterableObservation>(
  rows: readonly T[],
): Array<DayCluster<T>> {
  const ordered = stableOrder(rows);
  const map = new Map<string, T[]>();
  for (const row of ordered) {
    const key = utcDayKey(row.detectedAt);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return [...map.entries()]
    .map(([day, clusterRows]) => ({ day, rows: clusterRows }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export function clusterCount<T extends ClusterableObservation>(rows: readonly T[]): number {
  return buildDayClusters(rows).length;
}
