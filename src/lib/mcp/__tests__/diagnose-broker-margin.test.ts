import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase, type FakeCall } from "@/test/fakes/supabase";

const estimateMargin = vi.fn();

vi.mock("@/lib/metaapi/margin.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/metaapi/margin.server")>();
  return { ...actual, estimateMargin: (...args: unknown[]) => estimateMargin(...args) };
});
import { runDiagnoseBrokerMargin } from "../tools/diagnose-broker-margin";

const args = {
  account_id: "c853c3b3-de42-47d6-8592-46117f09e4c9",
  logical_symbol: "EURUSD",
  action_type: "ORDER_TYPE_SELL" as const,
  volume: 0.16,
  open_price: 1.14488,
};

function db() {
  return createFakeSupabase((call: FakeCall) => {
    if (call.table === "connected_trading_accounts") {
      return {
        data: [
          {
            id: args.account_id,
            metaapi_account_id: "provider-account-secret-id",
            region: "london",
            phase: "ready",
            connection_status: "CONNECTED",
            provisioning_state: "DEPLOYED",
            trade_allowed: true,
            investor_mode: false,
            broker_observed_at: "2026-09-24T14:45:01.252Z",
            disconnected_at: null,
          },
        ],
        error: null,
      };
    }
    if (call.table === "connected_account_symbols") {
      return { data: [{ broker_symbol: "EURUSD.c", mapping_kind: "suffix" }], error: null };
    }
    if (call.table === "connected_account_specs") {
      return {
        data: [{ volume_min: 0.01, volume_max: 20, volume_step: 0.01, volume_limit: null }],
        error: null,
      };
    }
    return { data: [], error: null };
  });
}

describe("authenticated broker-margin diagnostic", () => {
  beforeEach(() => {
    estimateMargin.mockReset();
  });

  it("[INVARIANT] sends only the mapped, normalized margin request and returns no provider id", async () => {
    estimateMargin.mockImplementation(
      async (
        _id: string,
        _region: string,
        _request: unknown,
        hooks: Record<string, ((value: unknown) => void) | undefined>,
      ) => {
        hooks["onRequestObservation"]?.({
          httpStatus: 200,
          elapsedMs: 31,
          contentType: "application/json; charset=utf-8",
          responseShape: "json_object",
          timedOut: false,
          errorType: null,
        });
        hooks["onResponseInspection"]?.({
          marginExists: true,
          rawMarginType: "number",
          marginFinite: true,
          marginValue: 257.98,
        });
        return 257.98;
      },
    );

    const out = await runDiagnoseBrokerMargin(db().client, args);
    if (!("structuredContent" in out)) throw new Error("diagnostic did not return evidence");
    const payload = out.structuredContent as Record<string, unknown>;

    expect(estimateMargin).toHaveBeenCalledWith(
      "provider-account-secret-id",
      "london",
      { symbol: "EURUSD.c", type: "ORDER_TYPE_SELL", volume: 0.16, openPrice: 1.14488 },
      expect.any(Object),
    );
    expect(payload).toMatchObject({
      non_trading_diagnostic: true,
      trade_endpoint_called: false,
      http_status: 200,
      margin_exists: true,
      raw_margin_type: "number",
      margin_finite: true,
      margin: 257.98,
      readiness: {
        snapshot_source: "stored_broker_state_immediately_before_request",
        phase: "ready",
        connection_status: "CONNECTED",
        provisioning_state: "DEPLOYED",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("provider-account-secret-id");
  });

  it("[INVARIANT] refuses an off-step volume before any MetaApi request", async () => {
    const out = await runDiagnoseBrokerMargin(db().client, { ...args, volume: 0.165 });
    expect(out.isError).toBe(true);
    expect(estimateMargin).not.toHaveBeenCalled();
  });
});
