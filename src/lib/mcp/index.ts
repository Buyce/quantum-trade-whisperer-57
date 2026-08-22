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
    "Tools for P-Trades Hub, an autonomous forex market scanner and trade assistant. Read published scanner setups with `list_signals` (scope='all_published' = all retained published rows including retained historical/resolved ones; scope='my_scanner' = rows currently eligible under the user's feed settings, retention window and daily cap). An empty `list_signals` result only means nothing matched those filters — it is not evidence about the scanner's current cycle, and never invent rows, and `get_scanner_status` / `get_market_status` for engine health and which FX sessions are open. `get_my_settings` and `update_my_settings` read and change the user's own filters, alert grade, daily cap (0 = unlimited) and risk profile. `calculate_position_size` sizes a setup from that risk profile. `get_intelligence` exposes the Bayesian learning engine's regime priors, sample sizes and gate status, and `get_shadow_comparison` the weekly A+/A vs B/C shadow-replay comparison with significance. Maintain the journal with `log_trade_decision` and `update_trade_outcome` (supply real entry/exit prices so R is recomputed and the trade counts as verified), and read it with `list_my_trades` / `get_performance_summary`. Everything is live broker-derived: never fabricate signals, prices or results, and never state an estimate the tool reported as unavailable or advisory.",
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
