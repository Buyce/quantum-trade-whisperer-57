/**
 * P-Trades capability registry.
 *
 * This is deliberately explicit: adding code or a data feed does not make it
 * execution-authoritative. Only "enforced" capabilities may veto/authorize
 * production execution. "shadow" can observe and measure; "unavailable" cannot
 * be represented as evidence.
 */
export type CapabilityMode = "enforced" | "shadow" | "unavailable";

export type TradingCapability =
  | "strategy_kernel"
  | "account_prop_rules"
  | "same_bet_exposure"
  | "execution_quality"
  | "managed_break_even"
  | "managed_trailing"
  | "direct_mt5_observation"
  | "direct_mt5_execution"
  | "exchange_microstructure"
  | "digital_twin"
  | "adaptive_learning";

export interface CapabilityState {
  id: TradingCapability;
  mode: CapabilityMode;
  executionAuthority: boolean;
  reason: string;
}

export const TRADING_CAPABILITIES: Readonly<Record<TradingCapability, CapabilityState>> =
  Object.freeze({
    strategy_kernel: {
      id: "strategy_kernel",
      mode: "enforced",
      executionAuthority: true,
      reason: "Canonical strategy/risk/execution veto kernel.",
    },
    account_prop_rules: {
      id: "account_prop_rules",
      mode: "enforced",
      executionAuthority: true,
      reason: "Account-scoped policy is evaluated before connected-account execution.",
    },
    same_bet_exposure: {
      id: "same_bet_exposure",
      mode: "enforced",
      executionAuthority: true,
      reason: "New automatic orders are constrained by same-bet/exposure controls.",
    },
    execution_quality: {
      id: "execution_quality",
      mode: "enforced",
      executionAuthority: true,
      reason: "Measured execution-quality cooldowns may refuse new orders.",
    },
    managed_break_even: {
      id: "managed_break_even",
      mode: "enforced",
      executionAuthority: true,
      reason: "Reduce-only managed exits are broker-confirmed and demo-gated.",
    },
    managed_trailing: {
      id: "managed_trailing",
      mode: "enforced",
      executionAuthority: true,
      reason: "Owner-opted trailing is reduce-only and never widens risk.",
    },
    direct_mt5_observation: {
      id: "direct_mt5_observation",
      mode: "enforced",
      executionAuthority: false,
      reason: "Direct MT5 bridge may report broker truth but cannot trade.",
    },
    direct_mt5_execution: {
      id: "direct_mt5_execution",
      mode: "unavailable",
      executionAuthority: false,
      reason: "No order_send capability until Runtime Validation and demo canary pass.",
    },
    exchange_microstructure: {
      id: "exchange_microstructure",
      mode: "shadow",
      executionAuthority: false,
      reason:
        "COMEX/venue microstructure contracts are research-only until holdout evidence exists.",
    },
    digital_twin: {
      id: "digital_twin",
      mode: "shadow",
      executionAuthority: false,
      reason: "Replay can measure policies but cannot promote them into production.",
    },
    adaptive_learning: {
      id: "adaptive_learning",
      mode: "shadow",
      executionAuthority: false,
      reason: "No self-modifying production policy; evidence promotion remains separate.",
    },
  });

export function mayInfluenceExecution(id: TradingCapability): boolean {
  const state = TRADING_CAPABILITIES[id];
  return state.mode === "enforced" && state.executionAuthority;
}
