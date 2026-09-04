/**
 * Prompt 14 Stage 3 closure — arming a connected account, as pure rules.
 *
 * `mode` is the ONLY thing that makes an account a destination for automatic
 * orders, so the rules that let a trader change it live here, away from any
 * I/O, and are covered by invariant tests.
 *
 * Two hard rules:
 *  1. The BROKER's account type decides which modes are even offerable. A demo
 *     mode can never be armed on a real-money account and vice versa.
 *  2. Arming is refused unless the connection is READY, un-conflicted, and the
 *     broker itself reports the account as tradable (not investor/read-only).
 *
 * Pure: no fetch, no env, no clock.
 */
import type { AccountType } from "@/lib/metaapi/classify";
import type { AccountMode } from "./types";

export const ACCOUNT_MODES: AccountMode[] = ["observe", "demo_auto", "live_confirm", "live_auto"];

export function isAccountMode(value: unknown): value is AccountMode {
  return typeof value === "string" && (ACCOUNT_MODES as string[]).includes(value);
}

export interface ModeContext {
  brokerAccountType: AccountType;
  ready: boolean;
  intentConflict: boolean;
  tradeAllowed: boolean | null;
  investorMode: boolean | null;
  /** MetaApi account id — an account with no broker connection is not armable. */
  hasBrokerConnection: boolean;
  /** MT magic number, required so evidence can be positively associated. */
  hasMagic: boolean;
  /** Account-level emergency stop overrides every non-observe mode. */
  emergencyStopped: boolean;
}

export type ModeVerdict = { ok: true } | { ok: false; detail: string };

/** Modes the trader may pick for THIS account, given what the broker reports. */
export function offerableModes(ctx: ModeContext): AccountMode[] {
  const modes: AccountMode[] = ["observe"];
  if (canArm(ctx, "demo_auto").ok) modes.push("demo_auto");
  if (canArm(ctx, "live_confirm").ok) modes.push("live_confirm");
  if (canArm(ctx, "live_auto").ok) modes.push("live_auto");
  return modes;
}

/**
 * May this account be moved into `mode` right now?
 *
 * `observe` is always allowed: standing down is never blocked.
 */
export function canArm(ctx: ModeContext, mode: AccountMode): ModeVerdict {
  if (mode === "observe") return { ok: true };

  if (!ctx.hasBrokerConnection) {
    return { ok: false, detail: "this account has no live broker connection yet" };
  }
  if (!ctx.ready) {
    return { ok: false, detail: "your broker has not confirmed this account yet" };
  }
  if (ctx.emergencyStopped) {
    return {
      ok: false,
      detail: "this account is emergency-stopped; disable the stop before arming it",
    };
  }
  if (ctx.intentConflict) {
    return {
      ok: false,
      detail: "this account is flagged because your broker disagrees with how you labelled it",
    };
  }
  if (ctx.tradeAllowed !== true) {
    return { ok: false, detail: "your broker reports that trading is not allowed on this account" };
  }
  if (ctx.investorMode === true) {
    return {
      ok: false,
      detail: "this is an investor (read-only) login, so it cannot place orders",
    };
  }
  if (!ctx.hasMagic) {
    return { ok: false, detail: "this account has no order tag assigned yet — refresh it first" };
  }

  if (mode === "demo_auto" && ctx.brokerAccountType !== "demo") {
    return {
      ok: false,
      detail: `Demo auto-execution needs a DEMO account. Your broker reports this as ${ctx.brokerAccountType.toUpperCase()}.`,
    };
  }
  if ((mode === "live_confirm" || mode === "live_auto") && ctx.brokerAccountType !== "real") {
    return {
      ok: false,
      detail: `Live execution needs a REAL money account. Your broker reports this as ${ctx.brokerAccountType.toUpperCase()}.`,
    };
  }
  return { ok: true };
}

/**
 * The mode an account must fall back to when the broker's facts no longer
 * support the armed mode. Standing down is automatic and silent-by-default is
 * NOT acceptable, so the reason is always returned with it.
 */
export function modeAfterReconcile(
  current: AccountMode,
  ctx: ModeContext,
): { mode: AccountMode; standDownReason: string | null } {
  if (current === "observe") return { mode: "observe", standDownReason: null };
  const verdict = canArm(ctx, current);
  if (verdict.ok) return { mode: current, standDownReason: null };
  return { mode: "observe", standDownReason: verdict.detail };
}

/** Plain-language description of what a mode does. Used by the UI and the guide. */
export function describeMode(mode: AccountMode): { label: string; detail: string } {
  switch (mode) {
    case "observe":
      return {
        label: "Observe only",
        detail:
          "P-Trades reads this account and places nothing. Every figure shown comes from your broker.",
      };
    case "demo_auto":
      return {
        label: "Demo auto-execution",
        detail:
          "Eligible setups are submitted to this DEMO account automatically as pending orders with a stop loss and the first target attached.",
      };
    case "live_confirm":
      return {
        label: "Live, confirm each order",
        detail:
          "Nothing is sent to your real account without your explicit confirmation of that specific setup.",
      };
    case "live_auto":
      return {
        label: "Live auto-execution",
        detail:
          "Eligible setups are submitted to your REAL account automatically. This requires the system-wide live switch and your own signed confirmation of the current configuration.",
      };
  }
}
