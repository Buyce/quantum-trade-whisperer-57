/**
 * Trade History filters for automatic broker orders.
 *
 * Pure predicates over the rows already loaded, so a filtered view can never
 * imply anything about rows outside the loaded page — the UI states the matched
 * count against the loaded count, never against "all your trades".
 *
 * Result classification uses BROKER money only. A row with no broker evidence is
 * "not filled" for filtering purposes and is never counted as a breakeven trade.
 */
import type { Grade } from "@/lib/db-types";
import type { BrokerOrderView } from "./broker-orders";

export type OrderResultFilter = "all" | "winners" | "losers" | "breakeven" | "open" | "not_filled";

export interface OrderFilterState {
  instruments: string[];
  grades: Array<Grade | "Unknown">;
  result: OrderResultFilter;
  minNet: number | null;
  maxNet: number | null;
}

export const EMPTY_ORDER_FILTERS: OrderFilterState = {
  instruments: [],
  grades: [],
  result: "all",
  minNet: null,
  maxNet: null,
};

export type OrderResultClass = "winner" | "loser" | "breakeven" | "open" | "not_filled";

export function orderResultClass(row: BrokerOrderView): OrderResultClass {
  if (row.status.kind === "open_at_broker") return "open";
  const net = row.broker?.netProfit ?? null;
  if (row.broker === null || net === null) return "not_filled";
  if (net > 0) return "winner";
  if (net < 0) return "loser";
  return "breakeven";
}

export function orderFiltersActive(filters: OrderFilterState): boolean {
  return (
    filters.instruments.length > 0 ||
    filters.grades.length > 0 ||
    filters.result !== "all" ||
    filters.minNet !== null ||
    filters.maxNet !== null
  );
}

export function filterBrokerOrders(
  rows: BrokerOrderView[],
  filters: OrderFilterState,
): BrokerOrderView[] {
  return rows.filter((row) => {
    if (filters.instruments.length > 0 && !filters.instruments.includes(row.instrument)) {
      return false;
    }
    if (filters.grades.length > 0 && !filters.grades.includes(row.grade)) return false;

    const result = orderResultClass(row);
    if (filters.result !== "all") {
      const wanted: Record<Exclude<OrderResultFilter, "all">, OrderResultClass> = {
        winners: "winner",
        losers: "loser",
        breakeven: "breakeven",
        open: "open",
        not_filled: "not_filled",
      };
      if (result !== wanted[filters.result]) return false;
    }

    if (filters.minNet !== null || filters.maxNet !== null) {
      const net = row.broker?.netProfit ?? null;
      // A money range is a claim about money. Rows the broker never priced are
      // excluded rather than treated as zero.
      if (net === null) return false;
      if (filters.minNet !== null && net < filters.minNet) return false;
      if (filters.maxNet !== null && net > filters.maxNet) return false;
    }
    return true;
  });
}

/** Instruments actually present in the loaded rows, sorted for a stable UI. */
export function instrumentsInRows(rows: BrokerOrderView[]): string[] {
  return [...new Set(rows.map((row) => row.instrument))].sort();
}

/** Grades actually present in the loaded rows, high to low, Unknown last. */
export function gradesInRows(rows: BrokerOrderView[]): Array<Grade | "Unknown"> {
  const order = ["A+", "A", "B", "C", "Unknown"];
  return [...new Set(rows.map((row) => row.grade))].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
  );
}

/** Broker-reported net money of the filtered set, per currency. Never summed across currencies. */
export function netByCurrency(rows: BrokerOrderView[]): Array<{
  currency: string;
  net: number;
  count: number;
}> {
  const map = new Map<string, { net: number; count: number }>();
  for (const row of rows) {
    const net = row.broker?.netProfit ?? null;
    if (net === null) continue;
    const currency = row.broker?.currency ?? "unreported currency";
    const bucket = map.get(currency) ?? { net: 0, count: 0 };
    bucket.net += net;
    bucket.count += 1;
    map.set(currency, bucket);
  }
  return [...map.entries()]
    .map(([currency, value]) => ({ currency, ...value }))
    .sort((a, b) => b.count - a.count);
}
