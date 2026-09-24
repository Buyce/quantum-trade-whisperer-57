import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listSignals from "./tools/list-signals";
import logTradeDecision from "./tools/log-trade-decision";
import updateTradeOutcome from "./tools/update-trade-outcome";
import listMyTrades from "./tools/list-my-trades";
import listBrokerTrades from "./tools/list-broker-trades";
import listMyAccounts from "./tools/list-my-accounts";
import getPerformanceSummary from "./tools/get-performance-summary";
import getScannerStatus from "./tools/get-scanner-status";
import getMySettings from "./tools/get-my-settings";
import updateMySettings from "./tools/update-my-settings";
import getMarketStatus from "./tools/get-market-status";
import calculatePositionSize from "./tools/calculate-position-size";
import getIntelligence from "./tools/get-intelligence";
import getShadowComparison from "./tools/get-shadow-comparison";
import getAutomaticOrders from "./tools/get-automatic-orders";
import getRiskHolds from "./tools/get-risk-holds";
import getPlatformBenchmarks from "./tools/get-platform-benchmarks";
import describeDatasets from "./tools/describe_datasets";
import readDataset from "./tools/read_dataset";
import diagnoseBrokerMargin from "./tools/diagnose-broker-margin";

// The OAuth issuer must be the direct Supabase host; the project ref is the only
// Supabase value that survives publish unchanged.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "p-trades-hub",
  title: "P-Trades Hub",
  version: "0.8.0",
  instructions:
    "Tools for P-Trades Hub, a deterministic forex market scanner and trade assistant. Read published scanner setups with `list_signals` (scope='all_published' = all retained published rows including retained historical/resolved ones; scope='my_scanner' = rows currently eligible under the user's feed settings, retention window and daily cap). An empty `list_signals` result only means nothing matched those filters — it is not evidence about the scanner's current cycle, and you must never invent rows. Use `get_scanner_status` / `get_market_status` for engine health, scanner state and which fixed-UTC FX session label is active. `get_automatic_orders` reads the user's own automatic-order decisions (queued, or refused with the engine's exact reason) and the resulting broker deliveries; `get_risk_holds` says whether their own risk brakes are currently holding new automatic orders, why, and when the hold lifts — both stop new orders only and never touch anything already at the broker, and an unreadable state reads as unknown, never as unheld. `get_my_settings` and `update_my_settings` read and change the user's own filters, alert grade, daily cap (0 = unlimited; it governs feed and alert eligibility, each channel using its own grade threshold), risk profile, automatic-order ceilings and window, gates and risk brakes including the same-bet limit and cool-off; every field that changes how much real money can be at risk needs `confirm_risk_change`. `calculate_position_size` sizes a setup from that user-entered profile. `get_intelligence` exposes descriptive in-sample replay rates, sample sizes and reporting-gate status; `get_shadow_comparison` exposes a diagnostic A+/A vs B/C Replay-V1 comparison. Neither is a forecast, expected return, broker performance or a live track record. Maintain the self-reported journal with `log_trade_decision` and `update_trade_outcome` (supply real entry/exit prices so R is recomputed; those prices are not broker verified), and read it with `list_my_trades`. `list_broker_trades` reads the user's own BROKER-CONFIRMED trades from broker evidence — the authority on what actually happened, windowed on the broker exit time and sortable by R; the self-reported journal can be empty even when the user traded, so an empty `list_my_trades` is never evidence that the user has no trades. `get_performance_summary` aggregates both cohorts separately (broker-confirmed and self-reported) over an optional UTC window. `list_my_accounts` lists the user's own connected broker accounts — DEMO and LIVE — with mode, phase, broker-reported balance, equity, margin, trade permission and connection state, so a trade, delivery or log line can be attributed to the right account; trades, automatic-order decisions, deliveries and performance cover every one of the user's accounts, demo included, and each figure must be quoted with its account mode because a demo result is never a live track record. `diagnose_broker_margin` runs one non-trading MetaApi calculate-margin request for an owned account after validating its symbol mapping and broker volume specification; it reports only sanitized readiness, transport and response-shape evidence and cannot call `/trade`. Published setup prices originate from broker candles; settings and journal entries originate from the user or their assistant; learning values originate from deterministic candle replay. `get_platform_benchmarks` returns platform-wide aggregates across all connected accounts (per-grade and per-instrument broker-verified outcome rates and average R, published setup counts, shadow coverage, instrument stages); it carries no account identity, no money amounts and no lot sizes, withholds cohorts under the minimum group size, and must never be used to infer another account's value. `describe_datasets` and `read_dataset` are an owner-gated, strictly read-only data surface for analysis and model training: paged real recorded rows from published setups, shadow replay outcomes, research candidates, broker-verified trades and the learning statistics, with account-identifying columns withheld and provenance stated on every page. They have no write path, and an empty page only means nothing was recorded in that window. Never fabricate signals, prices or results, and never state an unavailable, advisory or descriptive estimate as proven or predictive.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listSignals,
    getScannerStatus,
    getMarketStatus,
    getAutomaticOrders,
    getRiskHolds,
    getPlatformBenchmarks,
    getMySettings,
    updateMySettings,
    calculatePositionSize,
    getIntelligence,
    getShadowComparison,
    logTradeDecision,
    updateTradeOutcome,
    listMyTrades,
    listBrokerTrades,
    listMyAccounts,
    diagnoseBrokerMargin,
    getPerformanceSummary,
    describeDatasets,
    readDataset,
  ] as unknown as Parameters<typeof defineMcp>[0]["tools"],
});
