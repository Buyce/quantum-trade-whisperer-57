import { describe, expect, it } from "vitest";
import { readAllPages } from "../read-all-pages";

/** Simulates the Data API: never more than 1,000 rows per request. */
function fakeApi(total: number) {
  return async (from: number, to: number) => {
    const end = Math.min(to + 1, total, from + 1000);
    return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null };
  };
}

describe("readAllPages", () => {
  it("[INVARIANT] returns every eligible row past the 1,000-row server cap", async () => {
    const rows = await readAllPages<number>(fakeApi(3064), "t");
    expect(rows).toHaveLength(3064);
    expect(rows[3063]).toBe(3063);
  });
  it("[INVARIANT] refuses at the ceiling instead of truncating", async () => {
    await expect(readAllPages(fakeApi(5000), "t", 2000)).rejects.toThrow(/refusing/);
  });
  it("[INVARIANT] a read error throws", async () => {
    await expect(
      readAllPages(async () => ({ data: null, error: { message: "boom" } }), "t"),
    ).rejects.toThrow(/boom/);
  });
});
