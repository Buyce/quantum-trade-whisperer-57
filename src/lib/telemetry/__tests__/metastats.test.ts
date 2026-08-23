import { describe, expect, it } from "vitest";

import {
  describeSnapshot,
  METASTATS_INFLUENCES,
  normaliseMetrics,
  snapshotStale,
  toSnapshot,
  TELEMETRY_STALE_AFTER_MS,
} from "../metastats";
import { GUARDIAN_INFLUENCES, normaliseTrackerEvent, describeGuardian } from "../guardian";

describe("MetaStats telemetry normalisation", () => {
  it("[UNIT] maps the vendor's metric names and leaves absent fields null", () => {
    const metrics = normaliseMetrics({ trades: 12, wonTradesPercent: 58.5, profit: 240.75 });
    expect(metrics.trades).toBe(12);
    expect(metrics.winRatePercent).toBeCloseTo(58.5);
    expect(metrics.profit).toBeCloseTo(240.75);
    expect(metrics.equity).toBeNull();
    expect(metrics.maxDrawdownPercent).toBeNull();
  });

  it("[UNIT] refuses non-numeric vendor values instead of coercing them", () => {
    const metrics = normaliseMetrics({ trades: "many", equity: null, profit: Number.NaN });
    expect(metrics.trades).toBeNull();
    expect(metrics.equity).toBeNull();
    expect(metrics.profit).toBeNull();
  });

  it("[INVARIANT] a still-calculating account never renders as zero or as a loss", () => {
    const snapshot = toSnapshot({ status: "processing", retryAfterSeconds: 30 });
    expect(snapshot.status).toBe("processing");
    // No metrics object at all — there is nothing to round down to zero.
    expect(snapshot.metrics).toBeNull();
    expect(snapshot.retryAfterSeconds).toBe(30);
    const copy = describeSnapshot(snapshot).toLowerCase();
    expect(copy).toContain("still calculating");
    expect(copy).not.toContain("loss");
    expect(copy).not.toMatch(/\b0\b/);
  });

  it("[INVARIANT] unavailable telemetry states the reason and makes no trading claim", () => {
    const snapshot = toSnapshot({ status: "unavailable", reason: "billing required" });
    expect(snapshot.metrics).toBeNull();
    expect(snapshot.observedAt).toBeNull();
    const copy = describeSnapshot(snapshot).toLowerCase();
    expect(copy).toContain("unavailable");
    expect(copy).toContain("billing required");
    expect(copy).not.toContain("win");
    expect(copy).not.toContain("profit");
  });

  it("[INVARIANT] only an ok answer carries metrics, labelled with its observation time", () => {
    const snapshot = toSnapshot({
      status: "ok",
      data: { trades: 4, wonTradesPercent: 50 },
      observedAt: "2026-08-23T10:00:00.000Z",
    });
    expect(snapshot.status).toBe("ok");
    expect(snapshot.metrics?.trades).toBe(4);
    expect(snapshot.observedAt).toBe("2026-08-23T10:00:00.000Z");
    expect(describeSnapshot(snapshot)).toContain("BROKER-DERIVED");
  });

  it("[INVARIANT] MetaStats can never influence grading, eligibility, research or statistics", () => {
    expect(METASTATS_INFLUENCES.grade).toBe(false);
    expect(METASTATS_INFLUENCES.confidence).toBe(false);
    expect(METASTATS_INFLUENCES.eligibility).toBe(false);
    expect(METASTATS_INFLUENCES.research).toBe(false);
    expect(METASTATS_INFLUENCES.publishedStatistics).toBe(false);
  });

  it("[UNIT] a missing or unparseable observation time counts as stale", () => {
    const now = Date.parse("2026-08-23T12:00:00.000Z");
    expect(snapshotStale(null, now)).toBe(true);
    expect(snapshotStale("not a date", now)).toBe(true);
    expect(snapshotStale(new Date(now - 60_000).toISOString(), now)).toBe(false);
    expect(snapshotStale(new Date(now - TELEMETRY_STALE_AFTER_MS - 1).toISOString(), now)).toBe(
      true,
    );
  });
});

describe("Risk Guardian rules", () => {
  it("[INVARIANT] an unavailable guardian never implies the account is being watched", () => {
    const copy = describeGuardian({
      available: false,
      reason: "MetaApi does not support MT5 netting accounts.",
      trackers: [],
    });
    expect(copy).toContain("unavailable");
    expect(copy).toContain("netting");
    expect(copy).not.toContain("watching");
  });

  it("[INVARIANT] an available guardian with no created tracker says so plainly", () => {
    expect(
      describeGuardian({ available: true, reason: null, trackers: [] }),
    ).toContain("no drawdown tracker exists yet");
    expect(
      describeGuardian({
        available: true,
        reason: null,
        trackers: [{ key: "daily", vendorId: "t1", lastError: null }],
      }),
    ).toContain("watching 1 drawdown threshold");
  });

  it("[UNIT] tracker events get a stable fingerprint and a normalised instant", () => {
    const raw = {
      id: "e1",
      trackerId: "t1",
      sequenceNumber: 3,
      endBrokerTime: "2026-08-23 10:15:00.000",
      relativeDrawdown: 0.061,
    };
    const first = normaliseTrackerEvent(raw);
    const second = normaliseTrackerEvent({ ...raw });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.eventAt).toBe("2026-08-23T10:15:00.000Z");
    expect(first.relativeDrawdown).toBeCloseTo(0.061);
    expect(first.absoluteDrawdown).toBeNull();
  });

  it("[INVARIANT] a drawdown breach may affect execution and display, nothing else", () => {
    expect(GUARDIAN_INFLUENCES.execution).toBe(true);
    expect(GUARDIAN_INFLUENCES.scanner).toBe(false);
    expect(GUARDIAN_INFLUENCES.research).toBe(false);
    expect(GUARDIAN_INFLUENCES.grading).toBe(false);
    expect(GUARDIAN_INFLUENCES.publishedStatistics).toBe(false);
  });
});
