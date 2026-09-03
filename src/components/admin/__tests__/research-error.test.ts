/**
 * The latched research error must never masquerade as a live failure.
 * These tests pin the age/staleness contract the CandidatePanel renders.
 */
import { describe, expect, it } from "vitest";
import {
  describeResearchError,
  formatErrorAge,
  RESEARCH_ERROR_STALE_AFTER_MS,
} from "@/components/admin/research-error";

const NOW = new Date("2026-09-03T04:08:00Z");

describe("describeResearchError", () => {
  it("[INVARIANT] shows nothing when there is no error", () => {
    expect(describeResearchError(null, null, NOW)).toBeNull();
    expect(describeResearchError("", "2026-09-03T00:00:00Z", NOW)).toBeNull();
  });

  it("[INVARIANT] treats a fresh error as live", () => {
    const d = describeResearchError(
      "observation write exceeded deadline",
      "2026-09-03T03:00:00Z",
      NOW,
    );
    expect(d).not.toBeNull();
    expect(d!.stale).toBe(false);
    expect(d!.ageMs).toBe(68 * 60_000);
  });

  it("[INVARIANT] downgrades an old error to historical", () => {
    const d = describeResearchError(
      "observation write exceeded deadline",
      "2026-08-23T19:00:16Z",
      NOW,
    );
    expect(d).not.toBeNull();
    expect(d!.stale).toBe(true);
    expect(d!.ageMs).toBeGreaterThan(RESEARCH_ERROR_STALE_AFTER_MS);
  });

  it("[INVARIANT] never lies about a missing timestamp by hiding the error", () => {
    const d = describeResearchError("boom", null, NOW);
    expect(d).not.toBeNull();
    expect(d!.stale).toBe(false);
  });

  it("[INVARIANT] never crashes on an unparseable timestamp", () => {
    const d = describeResearchError("boom", "not-a-date", NOW);
    expect(d).not.toBeNull();
    expect(d!.stale).toBe(false);
  });

  it("[INVARIANT] clamps a future timestamp to zero age, never negative", () => {
    const d = describeResearchError("boom", "2026-09-04T00:00:00Z", NOW);
    expect(d!.ageMs).toBe(0);
    expect(d!.stale).toBe(false);
  });
});

describe("formatErrorAge", () => {
  it("formats minutes, hours and days with correct plurals", () => {
    expect(formatErrorAge(0)).toBe("0 minutes");
    expect(formatErrorAge(60_000)).toBe("1 minute");
    expect(formatErrorAge(68 * 60_000)).toBe("1 hour");
    expect(formatErrorAge(3 * 3_600_000)).toBe("3 hours");
    expect(formatErrorAge(11 * 86_400_000)).toBe("11 days");
  });
});
