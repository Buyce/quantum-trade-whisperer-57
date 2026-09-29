/**
 * The single catalogue of AI abilities, shared by the in-app assistant and the
 * MCP server (ChatGPT, Claude, Gemini, any MCP client). The Connect page, the
 * assistant's "what can you do?" answer and the parity test read from here.
 *
 * access:
 *   read    — reads the user's own data or aggregate platform data
 *   check   — runs a non-trading check (dry run; never calls /trade)
 *   journal — writes only the user's self-reported journal
 *   change  — changes settings, needs the user's explicit approval
 *   cancel  — cancels a waiting order, only after the user taps Approve
 *   trade   — acts at the broker, only inside a session the user approved
 */
export type Access = "read" | "check" | "journal" | "change" | "cancel" | "trade";

export interface AbilityEntry {
  name: string;
  access: Access;
  summary: string;
  /** Where it is available. The in-app assistant also has search_platform_docs / search_web. */
  surfaces: ("mcp" | "in_app")[];
}

const both: ("mcp" | "in_app")[] = ["mcp", "in_app"];

export const ABILITIES: AbilityEntry[] = [
  { name: "list_signals", access: "read", summary: "Published scanner setups.", surfaces: both },
  {
    name: "get_scanner_status",
    access: "read",
    summary: "Scanner health and last run.",
    surfaces: both,
  },
  {
    name: "get_market_status",
    access: "read",
    summary: "Open FX sessions and feed health.",
    surfaces: both,
  },
  {
    name: "get_automatic_orders",
    access: "read",
    summary: "Your automatic-order decisions and broker outcomes.",
    surfaces: both,
  },
  {
    name: "get_risk_holds",
    access: "read",
    summary: "Whether your risk brakes hold new orders.",
    surfaces: both,
  },
  { name: "get_my_settings", access: "read", summary: "Your full configuration.", surfaces: both },
  {
    name: "update_my_settings",
    access: "change",
    summary: "Change your settings (you approve every change).",
    surfaces: both,
  },
  {
    name: "calculate_position_size",
    access: "read",
    summary: "Size a setup from your risk profile.",
    surfaces: both,
  },
  {
    name: "get_intelligence",
    access: "read",
    summary: "Descriptive replay statistics.",
    surfaces: both,
  },
  {
    name: "get_shadow_comparison",
    access: "read",
    summary: "Shadow-replay grade comparison.",
    surfaces: both,
  },
  {
    name: "list_my_accounts",
    access: "read",
    summary: "Your demo and live accounts with broker figures.",
    surfaces: both,
  },
  {
    name: "list_broker_trades",
    access: "read",
    summary: "Your broker-confirmed trades.",
    surfaces: both,
  },
  {
    name: "list_my_trades",
    access: "read",
    summary: "Your self-reported journal.",
    surfaces: both,
  },
  {
    name: "get_performance_summary",
    access: "read",
    summary: "Your performance in R.",
    surfaces: both,
  },
  {
    name: "get_platform_benchmarks",
    access: "read",
    summary: "Anonymous platform-wide aggregates.",
    surfaces: both,
  },
  {
    name: "get_risk_policy",
    access: "read",
    summary: "Each account's risk policy (or Not set).",
    surfaces: both,
  },
  {
    name: "list_review_items",
    access: "read",
    summary: "Broker-vs-platform mismatches to review.",
    surfaces: both,
  },
  {
    name: "list_resting_orders",
    access: "read",
    summary: "Your unfilled waiting orders.",
    surfaces: both,
  },
  {
    name: "get_cohort_policies",
    access: "read",
    summary: "Your allow/reduce/block auto-trade rules.",
    surfaces: both,
  },
  {
    name: "list_news_blackouts",
    access: "read",
    summary: "Upcoming high-impact news events.",
    surfaces: both,
  },
  {
    name: "run_runtime_validation",
    access: "check",
    summary: "Nine-check dry run on your account. Never trades.",
    surfaces: both,
  },
  {
    name: "diagnose_broker_margin",
    access: "check",
    summary: "One non-trading margin check.",
    surfaces: ["mcp"],
  },
  {
    name: "propose_risk_policy",
    access: "change",
    summary: "Propose a risk policy; saved only after you approve.",
    surfaces: both,
  },
  {
    name: "propose_cohort_policy",
    access: "change",
    summary: "Propose allow/reduce/block; saved only after you approve.",
    surfaces: both,
  },
  {
    name: "propose_cancel_order",
    access: "cancel",
    summary: "Propose cancelling a waiting order; runs only after you approve.",
    surfaces: both,
  },
  {
    name: "request_trading_access",
    access: "change",
    summary: "Ask you for a time-limited trading session; nothing trades until you approve.",
    surfaces: both,
  },
  {
    name: "get_trading_access",
    access: "read",
    summary: "Show the active trading session and what's left.",
    surfaces: both,
  },
  {
    name: "place_order",
    access: "trade",
    summary: "Place a market or limit order inside your session. P-Trades sets the size.",
    surfaces: both,
  },
  {
    name: "modify_position",
    access: "trade",
    summary: "Move an open trade's stop loss or take profit inside your session.",
    surfaces: both,
  },
  {
    name: "close_position",
    access: "trade",
    summary: "Close all or part of an open trade inside your session.",
    surfaces: both,
  },
  {
    name: "modify_resting_order",
    access: "trade",
    summary: "Change a waiting order's prices inside your session (never its size).",
    surfaces: both,
  },
  {
    name: "arm_account",
    access: "trade",
    summary: "Switch an account to observe, demo auto or live confirm inside your session.",
    surfaces: both,
  },
  {
    name: "log_trade_decision",
    access: "journal",
    summary: "Add a journal entry.",
    surfaces: ["mcp"],
  },
  {
    name: "update_trade_outcome",
    access: "journal",
    summary: "Record a journal outcome.",
    surfaces: ["mcp"],
  },
  {
    name: "describe_datasets",
    access: "read",
    summary: "Owner-only dataset catalogue.",
    surfaces: ["mcp"],
  },
  {
    name: "read_dataset",
    access: "read",
    summary: "Owner-only paged dataset rows.",
    surfaces: ["mcp"],
  },
];

/** Things no AI connected to P-Trades can ever do. */
export const AI_NEVER = [
  "Trade, change, close or arm anything without a trading session you approved.",
  "Choose the order size — P-Trades always calculates it from your risk policy.",
  "Skip the safety checks, your blocked instruments, news blackout or emergency stop.",
  "Arm an account for live auto-execution (only you can, in P-Trades).",
  "Save a setting change without your tap on Approve.",
  "See another user's accounts, money or trades.",
];
