import { describe, expect, it } from "vitest";
import { outcomeForStatus, type ApiOutcome } from "../observe.server";

const DB_OUTCOMES = ["ok", "error", "timeout", "rate_limited", "refused"] satisfies ApiOutcome[];

describe("provider observation outcomes", () => {
  it("[INVARIANT] maps HTTP statuses to the database-constrained vocabulary", () => {
    expect(outcomeForStatus(200)).toBe("ok");
    expect(outcomeForStatus(429)).toBe("rate_limited");
    expect(outcomeForStatus(401)).toBe("refused");
    expect(outcomeForStatus(403)).toBe("refused");
    expect(outcomeForStatus(504)).toBe("error");
  });

  it("[INVARIANT] does not reintroduce legacy outcome names that the table rejects", () => {
    expect(DB_OUTCOMES).not.toContain("throttled" as ApiOutcome);
    expect(DB_OUTCOMES).not.toContain("unauthorized" as ApiOutcome);
  });
});
