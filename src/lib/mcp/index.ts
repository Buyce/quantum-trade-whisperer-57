import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listSignals from "./tools/list-signals";
import logTradeDecision from "./tools/log-trade-decision";
import updateTradeOutcome from "./tools/update-trade-outcome";
import listMyTrades from "./tools/list-my-trades";
import getPerformanceSummary from "./tools/get-performance-summary";
import getScannerStatus from "./tools/get-scanner-status";
import getMySettings from "./tools/get-my-settings";
import updateMySettings from "./tools/update-my-settings";
import getMarketStatus from "./tools/get-market-status";
import calculatePositionSize from "./tools/calculate-position-size";
import getIntelligence from "./tools/get-intelligence";
import getShadowComparison from "./tools/get-shadow-comparison";

// The OAuth issuer must be the direct Supabase host; the project ref is the only
// Supabase value that survives publish unchanged.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "p-trades-hub",
  title: "P-Trades Hub",
  version: "0.2.0",
  instructions:
    "Tools for P-Trades Hub, a deterministic forex market scanner and trade assistant. Read published scanner setups with `list_signals` (scope='all_published' = all retained published rows including retained historical/resolved ones; scope='my_scanner' = rows currently eligible under the user's feed settings, retention window and daily cap). An empty `list_signals` result only means nothing matched those filters — it is not evidence about the scanner's current cycle, and you must never invent rows. Use `get_scanner_status` / `get_market_status` for engine health, scanner state and which fixed-UTC FX session label is active. `get_my_settings` and `update_my_settings` read and change the user's own filters, alert grade, daily cap (0 = unlimited; it governs feed and alert eligibility, each channel using its own grade threshold) and risk profile. `calculate_position_size` sizes a setup from that user-entered profile. `get_intelligence` exposes descriptive in-sample replay rates, sample sizes and reporting-gate status; `get_shadow_comparison` exposes a diagnostic A+/A vs B/C Replay-V1 comparison. Neither is a forecast, expected return, broker performance or a live track record. Maintain the self-reported journal with `log_trade_decision` and `update_trade_outcome` (supply real entry/exit prices so R is recomputed; those prices are not broker verified), and read it with `list_my_trades` / `get_performance_summary`. Published setup prices originate from broker candles; settings and journal entries originate from the user or their assistant; learning values originate from deterministic candle replay. Never fabricate signals, prices or results, and never state an unavailable, advisory or descriptive estimate as proven or predictive.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listSignals,
    getScannerStatus,
    getMarketStatus,
    getMySettings,
    updateMySettings,
    calculatePositionSize,
    getIntelligence,
    getShadowComparison,
    logTradeDecision,
    updateTradeOutcome,
    listMyTrades,
    getPerformanceSummary,
  ] as unknown as Parameters<typeof defineMcp>[0]["tools"],
});
