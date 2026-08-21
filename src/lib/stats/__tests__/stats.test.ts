import { describe, expect, it } from "vitest";
import { wilsonInterval, newcombeDifference } from "../wilson";
import { buildDayClusters, clusterCount, stableOrder, utcDayKey } from "../clusters";
import { clusterBootstrapMeanR, createRng, MIN_CLUSTERS } from "../bootstrap";
import { assessEvidence, holdoutConfirmed, isSufficient } from "../evidence";
import { benjaminiHochberg, UndeclaredFamilyError } from "../bh";

const obs = (id: string, detectedAt: string, r: number) => ({ id, detectedAt, r });

describe("wilson / newcombe are diagnostics", () => {
  it("wilson brackets the point estimate and is flagged diagnostic-only", () => {
    const ci = wilsonInterval(30, 100)!;
    expect(ci.lo).toBeLessThan(0.3);
    expect(ci.hi).toBeGreaterThan(0.3);
    expect(ci.diagnosticOnly).toBe(true);
  });

  it("degenerate input returns null rather than a fake interval", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(wilsonInterval(5, 3)).toBeNull();
  });

  it("newcombe difference is bounded and diagnostic-only", () => {
    const d = newcombeDifference({ successes: 40, n: 80 }, { successes: 20, n: 80 })!;
    expect(d.lo).toBeGreaterThanOrEqual(-1);
    expect(d.hi).toBeLessThanOrEqual(1);
    expect(d.diagnosticOnly).toBe(true);
  });
});

describe("whole-UTC-day clustering", () => {
  it("one UTC day of multi-instrument rows forms exactly one cluster", () => {
    const rows = [
      obs("a", "2026-08-21T01:00:00.000Z", 1),
      obs("b", "2026-08-21T09:30:00.000Z", -1),
      obs("c", "2026-08-21T23:59:59.000Z", 2),
    ];
    expect(clusterCount(rows)).toBe(1);
    expect(buildDayClusters(rows)[0]!.rows).toHaveLength(3);
  });

  it("uses UTC, not local time, for the day key", () => {
    expect(utcDayKey("2026-08-21T23:30:00.000Z")).toBe("2026-08-21");
    expect(utcDayKey("2026-08-22T00:30:00.000Z")).toBe("2026-08-22");
  });

  it("stable order is detectedAt then id regardless of input order", () => {
    const a = obs("z", "2026-08-21T01:00:00.000Z", 1);
    const b = obs("a", "2026-08-21T01:00:00.000Z", 1);
    expect(stableOrder([a, b]).map((r) => r.id)).toEqual(["a", "z"]);
    expect(stableOrder([b, a]).map((r) => r.id)).toEqual(["a", "z"]);
  });
});

describe("cluster bootstrap", () => {
  const manyDays = Array.from({ length: 14 }, (_, d) =>
    obs(`d${d}`, `2026-08-${String(d + 1).padStart(2, "0")}T10:00:00.000Z`, d % 2 === 0 ? 1.5 : -1),
  );

  it("refuses an interval below the cluster floor", () => {
    const rows = [
      obs("a", "2026-08-21T01:00:00.000Z", 1),
      obs("b", "2026-08-21T02:00:00.000Z", -1),
      obs("c", "2026-08-21T03:00:00.000Z", 3),
    ];
    const out = clusterBootstrapMeanR(rows);
    expect(out.status).toBe("insufficient_clusters");
    expect(out.clusterN).toBe(1);
    expect(out.ciLo).toBeNull();
    expect(out.ciHi).toBeNull();
    expect(out.mean).toBeCloseTo(1, 10);
  });

  it("twelve rows in one UTC day are one cluster and get no interval", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      obs(`r${i}`, `2026-08-21T${String(i).padStart(2, "0")}:00:00.000Z`, i % 3 === 0 ? 2 : -1),
    );
    const out = clusterBootstrapMeanR(rows);
    expect(out.clusterN).toBe(1);
    expect(out.status).toBe("insufficient_clusters");
  });

  it("produces an interval once enough independent days exist", () => {
    const out = clusterBootstrapMeanR(manyDays);
    expect(out.clusterN).toBe(14);
    expect(out.clusterN).toBeGreaterThanOrEqual(MIN_CLUSTERS);
    expect(out.status).toBe("ok");
    expect(out.ciLo).not.toBeNull();
    expect(out.ciHi).not.toBeNull();
    expect(out.ciLo!).toBeLessThanOrEqual(out.mean!);
    expect(out.ciHi!).toBeGreaterThanOrEqual(out.mean!);
  });

  it("two runs are byte-identical and carry method/version/seed/runId", () => {
    const a = clusterBootstrapMeanR(manyDays, { seed: 12345, replicates: 500 });
    const b = clusterBootstrapMeanR([...manyDays].reverse(), { seed: 12345, replicates: 500 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.method).toBe("whole_utc_day_cluster_bootstrap");
    expect(a.version).toBe(1);
    expect(a.seed).toBe(12345);
    expect(a.runId).toContain("seed12345");
  });

  it("a different seed gives a different replicate distribution", () => {
    const a = clusterBootstrapMeanR(manyDays, { seed: 1, replicates: 500 });
    const b = clusterBootstrapMeanR(manyDays, { seed: 2, replicates: 500 });
    expect(a.mean).toBe(b.mean);
    expect(`${a.ciLo}:${a.ciHi}`).not.toBe(`${b.ciLo}:${b.ciHi}`);
  });

  it("seeded rng is reproducible", () => {
    const draw = (seed: number) => Array.from({ length: 5 }, createRng(seed));
    expect(draw(7)).toEqual(draw(7));
  });

  it("empty input is empty, not zero", () => {
    const out = clusterBootstrapMeanR([]);
    expect(out.status).toBe("empty");
    expect(out.mean).toBeNull();
  });
});

describe("evidence ladder", () => {
  const strong = {
    nA: 200,
    nB: 200,
    clustersA: 40,
    clustersB: 40,
    observedEffect: 0.2,
    predeclared: true,
    multiplicityControlled: true,
    intervalExcludesNull: true,
    holdoutConfirmed: false,
  };

  it("n = 3 is insufficient and carries no prescriptive wording", () => {
    const v = assessEvidence({ ...strong, nA: 3, nB: 3, clustersA: 2, clustersB: 2 });
    expect(v.level).toBe("insufficient");
    expect(v.note).toMatch(/No conclusion/i);
    expect(v.note).not.toMatch(/should|trade|prefer|avoid/i);
  });

  it("enough rows but too few independent days stays insufficient", () => {
    const v = assessEvidence({ ...strong, clustersA: 2, clustersB: 40 });
    expect(v.level).toBe("insufficient");
    expect(v.blockers.join(" ")).toMatch(/independent trading days/);
  });

  it("actionable is unreachable under the current holdout", () => {
    expect(holdoutConfirmed()).toBe(false);
    const v = assessEvidence({ ...strong, holdoutConfirmed: holdoutConfirmed() });
    expect(v.level).not.toBe("actionable");
    expect(v.level).toBe("suggestive");
    expect(v.blockers.join(" ")).toMatch(/holdout/);
  });

  it("undeclared or uncontrolled comparisons are only descriptive", () => {
    expect(assessEvidence({ ...strong, predeclared: false }).level).toBe("descriptive");
    expect(assessEvidence({ ...strong, multiplicityControlled: false }).level).toBe("descriptive");
    expect(assessEvidence({ ...strong, observedEffect: 0.001 }).level).toBe("descriptive");
  });

  it("isSufficient is the shared floor", () => {
    expect(isSufficient({ nA: 30, nB: 30, clustersA: 10, clustersB: 10 })).toBe(true);
    expect(isSufficient({ nA: 30, nB: 29, clustersA: 10, clustersB: 10 })).toBe(false);
  });
});

describe("BH is diagnostic and family-bounded", () => {
  const family = {
    familyKey: "grade_tier_weekly",
    declaredKeys: ["fill_rate", "win_rate", "mean_r"],
    experimentId: "exp-1",
  };

  it("uses the declared family size as m", () => {
    const out = benjaminiHochberg(family, [
      { key: "fill_rate", pValue: 0.01 },
      { key: "win_rate", pValue: 0.04 },
    ]);
    expect(out.m).toBe(3);
    expect(out.results[0]!.qValue).toBeCloseTo(0.03, 10);
    expect(out.note).toMatch(/Diagnostic only/);
  });

  it("q-values are monotone", () => {
    const out = benjaminiHochberg(family, [
      { key: "fill_rate", pValue: 0.2 },
      { key: "win_rate", pValue: 0.3 },
      { key: "mean_r", pValue: 0.9 },
    ]);
    const qs = out.results.map((r) => r.qValue);
    expect(qs[0]!).toBeLessThanOrEqual(qs[1]!);
    expect(qs[1]!).toBeLessThanOrEqual(qs[2]!);
    expect(Math.max(...qs)).toBeLessThanOrEqual(1);
  });

  it("rejects an undeclared hypothesis (rolling family)", () => {
    expect(() => benjaminiHochberg(family, [{ key: "surprise", pValue: 0.01 }])).toThrowError(
      UndeclaredFamilyError,
    );
  });

  it("rejects an unbounded/empty declaration and duplicate tests", () => {
    expect(() =>
      benjaminiHochberg({ ...family, declaredKeys: [] }, [{ key: "x", pValue: 0.1 }]),
    ).toThrowError(UndeclaredFamilyError);
    expect(() =>
      benjaminiHochberg(family, [
        { key: "fill_rate", pValue: 0.1 },
        { key: "fill_rate", pValue: 0.2 },
      ]),
    ).toThrowError(UndeclaredFamilyError);
  });
});
