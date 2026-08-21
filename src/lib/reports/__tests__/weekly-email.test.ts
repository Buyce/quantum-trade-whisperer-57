/**
 * Weekly email render gate. The template must render the honest statistical
 * frame: raw n, independent-day clusters, the dependence-aware interval, the
 * evidence level and blockers, the maturity horizon, censored/pending counts,
 * and an explicit R basis on every R figure. z/p may appear only as labelled
 * independence-assuming diagnostics.
 */
import { describe, expect, it } from "vitest";
import { render } from "@react-email/components";
import React from "react";
import { template } from "@/lib/email-templates/weekly-shadow-report";
import { buildReport, type ShadowRow } from "../weekly";
import { reportEmailData } from "../weekly.server";

const WINDOW_START = "2026-03-01T00:00:00.000Z";
const WINDOW_END = "2026-03-08T00:00:00.000Z";

function rows(grade: string, n: number, wins: number, days: number): ShadowRow[] {
  return Array.from({ length: n }, (_, i) => {
    const day = String(2 + (i % days)).padStart(2, "0");
    const detected = `2026-02-${day}T10:00:00.000Z`;
    return {
      id: `${grade}-${i}`,
      detected_at: detected,
      grade,
      status: "resolved",
      resolved_outcome: i < wins ? "win" : "loss",
      realized_r: i < wins ? 2 : -1,
      filled_at: detected,
      miss_distance_atr: null,
    };
  });
}

const renderTemplate = async (data: Record<string, unknown>) =>
  render(React.createElement(template.component as any, data as any), { plainText: true });

describe("weekly shadow report email", () => {
  it("[INVARIANT] preview data renders and never headlines a z-test", async () => {
    const html = await renderTemplate(template.previewData as Record<string, unknown>);
    expect(html).toMatch(/weekly shadow report/i);
    expect(html).not.toMatch(/Statistical significance \(two-proportion z-test\)/);
    expect(html).toMatch(/whole-UTC-day cluster bootstrap/i);
    expect(html).toMatch(/diagnostics assuming independence/i);
  });

  it("[INVARIANT] renders raw n, clusters, interval, evidence, maturity, pending and R basis", async () => {
    const report = buildReport({
      rows: [...rows("A", 40, 30, 12), ...rows("C", 40, 8, 12)],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    const data = reportEmailData(report);
    const html = await renderTemplate(data);

    expect(html).toMatch(/raw n \(resolved\)/i);
    expect(html).toMatch(/independent UTC days/i);
    expect(html).toMatch(/dependence-aware 95% interval/i);
    expect(html).toMatch(/evidence level/i);
    expect(html).toMatch(/maturity horizon: 24h/i);
    expect(html).toMatch(/pending_resolution/);
    expect(html).toMatch(/R basis: replay realized R/i);
    expect(html).toMatch(/whole_utc_day_cluster_bootstrap/);
  });

  it("[INVARIANT] an insufficient week states why no interval exists", async () => {
    const report = buildReport({
      rows: [...rows("A", 40, 40, 2), ...rows("C", 40, 0, 2)],
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    const html = await renderTemplate(reportEmailData(report));
    expect(html).toMatch(/insufficient/);
    expect(html).toMatch(/not reported/);
    expect(html).toMatch(/independent trading day/);
  });
});
