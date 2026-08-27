import { describe, expect, it } from "vitest";
import {
  brokerOrderDestination,
  brokerOrderPending,
  brokerOrderStatus,
  toBrokerOrderView,
  type BrokerOrderDeliveryRow,
  type BrokerOrderEvidenceRow,
} from "../broker-orders";

const delivery = (over: Partial<BrokerOrderDeliveryRow> = {}): BrokerOrderDeliveryRow => ({
  id: 1,
  signal_id: "sig",
  state: "sent",
  reason: null,
  dry_run: false,
  account_mode: "demo_auto",
  destination_type: "metaapi_direct",
  broker_symbol: "XAUUSD",
  broker_order_id: null,
  broker_retcode_string: null,
  submitted_volume: 0.1,
  submitted_entry: 2400,
  submitted_stop: 2390,
  submitted_target: 2420,
  submitted_at: "2026-08-24T10:00:00Z",
  entry_mode: "pending_limit",
  enqueued_at: "2026-08-24T09:59:00Z",
  ...over,
});

const evidence = (over: Partial<BrokerOrderEvidenceRow> = {}): BrokerOrderEvidenceRow => ({
  state: "closed",
  broker_account_type: "demo",
  direction: "long",
  volume: 0.1,
  entry_price: 2400.5,
  exit_price: 2420.5,
  entry_at: "2026-08-24T10:00:05Z",
  exit_at: "2026-08-24T14:00:00Z",
  gross_profit: 200,
  commission: -1,
  swap: 0,
  profit_currency: "USD",
  r_vs_plan: 1.9,
  r_vs_actual_risk: 1.85,
  r_availability: null,
  stop_provenance: "broker_stop",
  ...over,
});

describe("automatic broker orders", () => {
  it("[INVARIANT] never claims an outcome for a submitted-but-unconfirmed order", () => {
    const view = toBrokerOrderView(delivery({ state: "sent" }), null, null);
    expect(view.status.kind).toBe("awaiting_confirmation");
    expect(view.broker).toBeNull();
    expect(view.r.value).toBeNull();
    expect(brokerOrderPending(view)).toBe(true);
  });

  it("[INVARIANT] reports a rejection with the broker's own reason and no result", () => {
    const view = toBrokerOrderView(
      delivery({ state: "rejected", broker_retcode_string: "TRADE_RETCODE_NO_MONEY" }),
      null,
      null,
    );
    expect(view.status.kind).toBe("rejected");
    expect(view.status.detail).toBe("TRADE_RETCODE_NO_MONEY");
    expect(view.r.value).toBeNull();
    expect(brokerOrderPending(view)).toBe(false);
  });

  it("[UNIT] uses broker evidence for closed orders and exposes broker prices only", () => {
    const view = toBrokerOrderView(delivery({ state: "acknowledged" }), evidence(), null);
    expect(view.status.kind).toBe("closed_at_broker");
    expect(view.broker?.entryPrice).toBe(2400.5);
    expect(view.r.value).toBe(1.85);
    expect(view.r.provenance).toBe("canonical");
    expect(view.accountType).toBe("demo");
  });

  it("[INVARIANT] keeps an open broker position outcome-free", () => {
    const view = toBrokerOrderView(
      delivery({ state: "acknowledged" }),
      evidence({ state: "open", exit_price: null, exit_at: null, gross_profit: null }),
      null,
    );
    expect(view.status.kind).toBe("open_at_broker");
    expect(view.r.value).toBeNull();
    expect(brokerOrderPending(view)).toBe(true);
  });

  it("[INVARIANT] does not invent an R when the broker never supplied one", () => {
    const view = toBrokerOrderView(
      delivery(),
      evidence({
        r_vs_plan: null,
        r_vs_actual_risk: null,
        r_availability: "unavailable_no_prices",
      }),
      null,
    );
    expect(view.r.value).toBeNull();
    expect(view.r.reason).toBe("No actual entry/exit prices recorded.");
  });

  it("[INVARIANT] treats an unknown delivery state as an explicit non-claim", () => {
    expect(
      brokerOrderStatus(
        { state: "weird", reason: null, broker_retcode_string: null, submitted_at: null },
        null,
      ),
    ).toMatchObject({ kind: "unknown" });
  });

  it("[INVARIANT] never attributes a P-Trades pre-send refusal to the broker", () => {
    const status = brokerOrderStatus(
      {
        state: "rejected",
        reason: "limit_price_not_on_pending_side: market 4649 vs 4634",
        broker_retcode_string: null,
        submitted_at: null,
      },
      null,
    );
    expect(status.kind).toBe("not_sent");
    expect(status.label).toBe("Not sent — refused by P-Trades");
    expect(status.detail).toContain("pending limit order could not rest");
    expect(status.detail).toContain("market 4649 vs 4634");
  });

  it("[INVARIANT] still names the broker when a broker return code exists", () => {
    const status = brokerOrderStatus(
      {
        state: "rejected",
        reason: "broker_rejected",
        broker_retcode_string: "TRADE_RETCODE_INVALID_STOPS",
        submitted_at: "2026-08-24T10:00:00Z",
      },
      null,
    );
    expect(status.kind).toBe("rejected");
    expect(status.label).toBe("Rejected by broker");
  });
});

describe("brokerOrderDestination", () => {
  it("[UNIT] names the connected broker account for a direct delivery", () => {
    expect(brokerOrderDestination("metaapi_direct")).toEqual({
      kind: "broker_account",
      label: "Connected broker account",
    });
  });

  it("[UNIT] names the webhook bridge, so a bridge dry-run is not read as the broker account", () => {
    expect(brokerOrderDestination("bridge_json").kind).toBe("webhook_bridge");
    expect(brokerOrderDestination("bridge_form").kind).toBe("webhook_bridge");
  });

  it("[UNIT] claims nothing when the destination was not recorded", () => {
    expect(brokerOrderDestination(null)).toEqual({
      kind: "unknown",
      label: "Destination not recorded",
    });
  });
});
