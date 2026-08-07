import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listSignals from "./tools/list-signals";
import logTradeDecision from "./tools/log-trade-decision";
import updateTradeOutcome from "./tools/update-trade-outcome";
import listMyTrades from "./tools/list-my-trades";
import getPerformanceSummary from "./tools/get-performance-summary";
import getScannerStatus from "./tools/get-scanner-status";

// The OAuth issuer must be the direct Supabase host; the project ref is the only
// Supabase value that survives publish unchanged.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "p-trades-hub",
  title: "P-Trades Hub",
  version: "0.1.0",
  instructions:
    "Tools for P-Trades Hub, an autonomous forex market scanner and trade assistant. Use `list_signals` to read live scanner setups (an empty result means no valid setup — never invent one), `get_scanner_status` for scanner health and the user's filters, `log_trade_decision` and `update_trade_outcome` to maintain the user's trade journal, and `list_my_trades` / `get_performance_summary` for their R-multiple performance. All data is live broker-derived; never fabricate signals or results.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listSignals,
    getScannerStatus,
    logTradeDecision,
    updateTradeOutcome,
    listMyTrades,
    getPerformanceSummary,
  ],
});
