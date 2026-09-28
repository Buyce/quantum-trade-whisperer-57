/**
 * Owner-only, non-trading runtime validation.
 *
 * This path can read broker state and call MetaApi calculate-margin, but it has
 * no import from metaapi/trade.server and cannot arm an account or submit an order.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { accountExecutionPolicy } from "@/lib/accounts/policy.server";
import { runDiagnoseBrokerMargin } from "@/lib/mcp/tools/diagnose-broker-margin";

const OWNER_EMAIL = "boatengampomah@gmail.com";

export interface RuntimeValidationInput {
  accountId: string;
  logicalSymbol: string;
  actionType: "ORDER_TYPE_BUY" | "ORDER_TYPE_SELL";
  volume: number;
  openPrice: number;
}

export interface RuntimeValidationResult {
  dryRun: true;
  tradeEndpointCalled: false;
  accountId: string;
  policy: {
    ok: boolean;
    riskPercent: number | null;
    status: "allow" | "warning" | "block";
    reasons: string[];
    detail: string | null;
  };
  margin: Record<string, unknown> | null;
  gates: {
    policy: boolean;
    symbolAndVolume: boolean;
    margin: boolean;
    noTradePath: true;
  };
  readyForControlledLiveConfirm: boolean;
}

export const runRuntimeValidation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: RuntimeValidationInput) => data)
  .handler(async ({ context, data }): Promise<RuntimeValidationResult> => {
    const email = String(context.claims["email"] ?? "").toLowerCase();
    if (email !== OWNER_EMAIL) throw new Error("Forbidden");

    const userId = String(context.claims["sub"] ?? "");
    if (!userId) throw new Error("Authenticated user id unavailable");

    const accountId = String(data.accountId ?? "").trim();
    const logicalSymbol = String(data.logicalSymbol ?? "")\n      .trim()\n      .toUpperCase();
    const volume = Number(data.volume);
    const openPrice = Number(data.openPrice);
    if (!accountId || !logicalSymbol || !Number.isFinite(volume) || volume <= 0) {
      throw new Error("A valid account, symbol and positive volume are required.");
    }
    if (!Number.isFinite(openPrice) || openPrice <= 0) {
      throw new Error("A finite positive open price is required.");
    }

    // Broker balance/equity are read from the latest broker-synchronized row.
    // accountExecutionPolicy then performs its normal fail-closed account-wide
    // evidence checks. It does not submit orders.
    const { data: account, error: accountError } = await context.supabase
      .from("connected_trading_accounts")
      .select("broker_equity, broker_balance, disconnected_at")
      .eq("id", accountId)
      .maybeSingle();
    if (accountError || !account || account.disconnected_at) {
      throw new Error(accountError?.message ?? "Active account not found");
    }

    const policyResult = await accountExecutionPolicy(context.supabase as never, {
      accountId,
      userId,
      equity:
        typeof account.broker_equity === "number"
          ? account.broker_equity
          : Number(account.broker_equity) || null,
      balance:
        typeof account.broker_balance === "number"
          ? account.broker_balance
          : Number(account.broker_balance) || null,
    });

    const marginResult = await runDiagnoseBrokerMargin(context.supabase, {
      account_id: accountId,
      logical_symbol: logicalSymbol,
      action_type: data.actionType,
      volume,
      open_price: openPrice,
    });
    const margin =
      "structuredContent" in marginResult
        ? (marginResult.structuredContent as Record<string, unknown>)
        : null;
    const marginOk =
      margin?.["trade_endpoint_called"] === false &&
      margin?.["margin_finite"] === true &&
      typeof margin?.["margin"] === "number";
    const policyOk = policyResult.ok;

    return {
      dryRun: true,
      tradeEndpointCalled: false,
      accountId,
      policy: policyResult.ok
        ? {
            ok: true,
            riskPercent: policyResult.riskPercent,
            status: policyResult.status,
            reasons: policyResult.reasons,
            detail: null,
          }
        : {
            ok: false,
            riskPercent: null,
            status: "block",
            reasons: ["account_risk_policy"],
            detail: policyResult.detail,
          },
      margin,
      gates: {
        policy: policyOk,
        symbolAndVolume: margin !== null,
        margin: marginOk,
        noTradePath: true,
      },
      readyForControlledLiveConfirm: policyOk && marginOk,
    };
  });
