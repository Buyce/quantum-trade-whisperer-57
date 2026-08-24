import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();

vi.mock("../request.server", () => ({
  metaApiRequest: (input: unknown) => request(input),
}));

import {
  fetchDeals,
  fetchHistoryOrders,
  HISTORY_MAX_PAGES,
  HISTORY_PAGE_SIZE,
} from "../history.server";

const START = new Date("2026-08-20T00:00:00.000Z");
const END = new Date("2026-08-23T00:00:00.000Z");

beforeEach(() => request.mockReset());

describe("MetaApi history pagination", () => {
  it("[INVARIANT] reads every page instead of silently accepting the first 1,000 rows", async () => {
    request
      .mockResolvedValueOnce(Array.from({ length: HISTORY_PAGE_SIZE }, (_, id) => ({ id })))
      .mockResolvedValueOnce([{ id: HISTORY_PAGE_SIZE }]);

    const rows = await fetchDeals("account", "new-york", START, END);

    expect(rows).toHaveLength(HISTORY_PAGE_SIZE + 1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      path: expect.stringContaining("?offset=0&limit=1000"),
    });
    expect(request.mock.calls[1]?.[0]).toMatchObject({
      path: expect.stringContaining("?offset=1000&limit=1000"),
    });
  });

  it("[INVARIANT] applies the same complete-population rule to history orders", async () => {
    request.mockResolvedValueOnce([{ id: "order-1" }]);
    await expect(fetchHistoryOrders("account", "new-york", START, END)).resolves.toHaveLength(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      path: expect.stringContaining("/history-orders/time/"),
    });
  });

  it("[INVARIANT] fails closed rather than returning a truncated history population", async () => {
    request.mockResolvedValue(Array.from({ length: HISTORY_PAGE_SIZE }, (_, id) => ({ id })));

    await expect(fetchDeals("account", "new-york", START, END)).rejects.toThrow(
      `exceeded ${HISTORY_MAX_PAGES * HISTORY_PAGE_SIZE} rows`,
    );
  });
});
