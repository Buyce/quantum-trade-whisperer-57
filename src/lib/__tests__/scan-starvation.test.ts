/**
 * Starvation and link-health classification.
 *
 * These guard the failure mode that hid a seven-hour scanner outage: jobs kept
 * closing as `done` while every one of them was discarded before any candle was
 * fetched, so the queue looked healthy and the engine analysed nothing.
 */
import { describe, expect, it } from "vitest";
import { classifyLinkHealth, classifyScanStarvation } from "../engine-status";

describe("classifyScanStarvation", () => {
  it("[INVARIANT] all work discarded is a fault, never a healthy engine", () => {
    const s = classifyScanStarvation({ total: 36, stale: 36, analysed: 0 });
    expect(s.state).toBe("starved");
    expect(s.tone).toBe("bad");
    expect(s.isFault).toBe(true);
    expect(s.staleShare).toBe(1);
  });

  it("[UNIT] flags a partial discard rate above the fault share", () => {
    const s = classifyScanStarvation({ total: 36, stale: 12, analysed: 24 });
    expect(s.state).toBe("partial");
    expect(s.isFault).toBe(true);
  });

  it("[UNIT] treats an occasional discard as healthy", () => {
    const s = classifyScanStarvation({ total: 36, stale: 2, analysed: 34 });
    expect(s.state).toBe("healthy");
    expect(s.isFault).toBe(false);
  });

  it("[UNIT] no finished jobs is unknown, and the weekend pause is not a fault", () => {
    expect(classifyScanStarvation({ total: 0, stale: 0, analysed: 0 }).tone).toBe("warn");
    const weekend = classifyScanStarvation({
      total: 0,
      stale: 0,
      analysed: 0,
      weekendClosed: true,
    });
    expect(weekend.tone).toBe("good");
    expect(weekend.isFault).toBe(false);
  });
});

describe("classifyLinkHealth", () => {
  it("[INVARIANT] no samples means not measured, never OK", () => {
    expect(classifyLinkHealth(null).unmeasured).toBe(true);
    expect(classifyLinkHealth({ ok: 0, failed: 0 }).value).toBe("NOT MEASURED YET");
  });

  it("[UNIT] a high failure share reads FAILING", () => {
    const h = classifyLinkHealth({ ok: 105, failed: 49 });
    expect(h.value).toBe("FAILING");
    expect(h.tone).toBe("bad");
  });

  it("[UNIT] a few failures read DEGRADED, none reads OK", () => {
    expect(classifyLinkHealth({ ok: 100, failed: 1 }).value).toBe("DEGRADED");
    expect(classifyLinkHealth({ ok: 100, failed: 0 }).value).toBe("OK");
  });

  it("[UNIT] names the larger measured cause and nothing more", () => {
    expect(
      classifyLinkHealth({ ok: 10, failed: 9, failed_timeout: 7, failed_dns: 2 }).dominantCause,
    ).toBe("timeout");
    expect(
      classifyLinkHealth({ ok: 10, failed: 9, failed_timeout: 1, failed_dns: 8 }).dominantCause,
    ).toBe("dns");
    expect(
      classifyLinkHealth({ ok: 10, failed: 9, failed_timeout: 2, failed_dns: 1, failed_5xx: 6 })
        .dominantCause,
    ).toBe("server_error");
    expect(
      classifyLinkHealth({ ok: 10, failed: 9, failed_5xx: 6 }).causeLabel,
    ).toContain("5xx");
  });

  it("[INVARIANT] an unattributed failure is never given a cause", () => {
    const h = classifyLinkHealth({ ok: 10, failed: 9 });
    expect(h.dominantCause).toBeNull();
    expect(h.causeLabel).toBe("");
    // A healthy link reports no cause either, rather than a stale one.
    expect(classifyLinkHealth({ ok: 10, failed: 0, failed_dns: 5 }).dominantCause).toBeNull();
  });
});
