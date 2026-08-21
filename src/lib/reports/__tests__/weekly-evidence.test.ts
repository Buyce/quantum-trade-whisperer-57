/**
 * Stage 5 blocking gate: the weekly report may not invent significance and may
 * not count plans that have not had time to resolve.
 */
import { describe, expect, it } from "vitest";
import { buildReport, MATURITY_HOURS, partitionByMaturity, type ShadowRow } from "../weekly";
import { MIN_GROUP_CLUSTERS, MIN_GROUP_SAMPLES } from "@/lib/stats/evidence";

const WINDOW_END = "2026-03-08T00:00:00.000Z";
const WINDOW_START = "2026-03-01T00:00:00.000Z";

function row(over: Partial<ShadowRow> & { detected_at: string; grade: string }): ShadowRow {
  return {
    status: "resolved",
    resolved_outcome: "win",
    realized_r: 1,
    filled_at: over.detected_at,
    miss_distance_atr: null,
    ...over,
  };
}

/** n resolved rows for one tier, spread one per UTC day so clusters are real. */
function tierRows(grade: string, n: number, wins: number, days: number): ShadowRow[] {
  const out: ShadowRow[] = [];
  for (let i = 0; i < n; i++) {
    const day = String(2 + (i % days)).padStart(2, "0");
    out.push(
      row({
        id: `${grade}-${i}`,
        detected_at: `2026-02-${day}T10:00:00.000Z`,
        grade,
        resolved_outcome: i < wins ? "win" : "loss",
        realized_r: i < wins ? 2 : -1,
      }),
    );
  }
  return out;
}

describe("weekly report evidence + censoring", () => {
  it("[INVARIANT] plans detected inside the maturity horizon are censored, not counted as unresolved", () => {
    const rows = [
      row({ id: "old", detected_at: "2026-03-02T00:00:00.000Z", grade: "A" }),
      row({ id: "fresh", detected_at: "2026-03-07T12:00:00.000Z", grade: "A" }),
    ];
    const { mature, immature } = partitionByMaturity(rows, WINDOW_END);
    expect(mature.map((r) => r.id)).toEqual(["old"]);
    expect(immature.map((r) => r.id)).toEqual(["fresh"]);

    const report = buildReport({ rows, windowStart: WINDOW_START, windowEnd: WINDOW_END });
    expect(report.immature).toBe(1);
    expect(report.maturityHours).toBe(MATURITY_HOURS);
    expect(report.high.resolved).toBe(1);
  });

  it("[INVARIANT] rows with no detection stamp are kept rather than censored on a guess", () => {
    const { mature, immature } = partitionByMaturity(
      [row({ id: "x", detected_at: "", grade: "A" })],
      WINDOW_END,
    );
    expect(mature).toHaveLength(1);
    expect(immature).toHaveLength(0);
  });

  it("[INVARIANT] an empty week draws no conclusion", () => {
    const report = buildReport({ rows: [], windowStart: WINDOW_START, windowEnd: WINDOW_END });
    expect(report.totalResolved).toBe(0);
    for (const c of report.comparisons) {
      expect(c.verdict).toBe("insufficient");
      expect(c.evidence.level).toBe("insufficient");
      expect(c.pValue).toBeNull();
    }
  });

  it("[INVARIANT] enough rows packed into too few trading days stays insufficient", () => {
    const rows = [
      ...tierRows("A", MIN_GROUP_SAMPLES + 5, MIN_GROUP_SAMPLES + 5, 2),
      ...tierRows("C", MIN_GROUP_SAMPLES + 5, 0, 2),
    ];
    const report = buildReport({ rows, windowStart: WINDOW_START, windowEnd: WINDOW_END });
    for (const c of report.comparisons) {
      expect(c.evidence.level).toBe("insufficient");
      expect(c.verdict).toBe("insufficient");
      expect(c.evidence.blockers.join(" ")).toContain("independent trading days");
    }
  });

  it("[INVARIANT] a large clean difference is capped at suggestive, never actionable", () => {
    const days = MIN_GROUP_CLUSTERS + 2;
    const n = MIN_GROUP_SAMPLES + days;
    const rows = [...tierRows("A", n, n, days), ...tierRows("C", n, 0, days)];
    const report = buildReport({ rows, windowStart: WINDOW_START, windowEnd: WINDOW_END });
    const win = report.comparisons.find((c) => c.metric === "win_rate")!;
    expect(win.highClusters).toBeGreaterThanOrEqual(MIN_GROUP_CLUSTERS);
    expect(win.lowClusters).toBeGreaterThanOrEqual(MIN_GROUP_CLUSTERS);
    expect(win.evidence.level).not.toBe("actionable");
    expect(win.evidence.blockers.join(" ")).toContain("holdout");
  });

  it("[INVARIANT] a p-value alone never earns the word significant", () => {
    // Two days only: p can be tiny, the verdict must still refuse.
    const rows = [...tierRows("A", 40, 40, 2), ...tierRows("C", 40, 0, 2)];
    const report = buildReport({ rows, windowStart: WINDOW_START, windowEnd: WINDOW_END });
    expect(report.comparisons.every((c) => c.verdict !== "significant")).toBe(true);
  });
});
