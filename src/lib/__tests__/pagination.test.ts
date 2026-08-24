import { describe, expect, it, vi } from "vitest";

import { collectCompletePages } from "../pagination";

describe("complete bounded pagination", () => {
  it("[INVARIANT] returns every row across stable inclusive ranges", async () => {
    const fetchPage = vi
      .fn<(from: number, to: number) => Promise<number[]>>()
      .mockResolvedValueOnce([0, 1])
      .mockResolvedValueOnce([2]);
    await expect(
      collectCompletePages({ fetchPage, pageSize: 2, maxPages: 3, overflowMessage: "overflow" }),
    ).resolves.toEqual([0, 1, 2]);
    expect(fetchPage.mock.calls).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("[INVARIANT] refuses to publish a partial population at the bound", async () => {
    const fetchPage = vi.fn(async () => [1, 2]);
    await expect(
      collectCompletePages({
        fetchPage,
        pageSize: 2,
        maxPages: 2,
        overflowMessage: "refusing incomplete journal metrics",
      }),
    ).rejects.toThrow(/refusing incomplete journal metrics/i);
  });
});
