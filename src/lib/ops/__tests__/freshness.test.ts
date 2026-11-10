import { describe, expect, it } from "vitest";
import { judgeFreshness } from "../freshness";

const tue = new Date("2026-11-10T13:20:00Z");
describe("pipeline freshness", () => {
  it("unreadable data service is failing, never healthy", () => {
    expect(judgeFreshness({ now: tue, readError: "PGRST303", lastSampleAt: null, lastSampleOk: null }).ok).toBe(false);
  });
  it("a last pass older than 30 minutes is stale", () => {
    const r = judgeFreshness({ now: tue, readError: null, lastSampleAt: "2026-11-10T12:49:00Z", lastSampleOk: true });
    expect(r.reason).toBe("stale");
  });
  it("a recent but failed pass is stale", () => {
    expect(judgeFreshness({ now: tue, readError: null, lastSampleAt: "2026-11-10T13:15:00Z", lastSampleOk: false }).ok).toBe(false);
  });
  it("a recent successful pass is fresh", () => {
    expect(judgeFreshness({ now: tue, readError: null, lastSampleAt: "2026-11-10T13:15:00Z", lastSampleOk: true }).ok).toBe(true);
  });
  it("weekend closure is not an alarm", () => {
    expect(judgeFreshness({ now: new Date("2026-11-14T12:00:00Z"), readError: null, lastSampleAt: null, lastSampleOk: null }).reason).toBe("market_closed");
  });
});
