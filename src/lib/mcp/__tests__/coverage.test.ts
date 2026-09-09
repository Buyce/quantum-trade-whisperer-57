/**
 * The assistant surface must not drift behind the terminal.
 *
 * Each test here pins a drift that actually happened: a hardcoded instrument
 * trio while the registry grew to twelve, and a settings surface that could not
 * see or set the automatic-order rules, gates and brakes users rely on.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REGISTRY_SYMBOLS } from "@/lib/instruments/registry";
import { SAME_BET_COOLDOWN_CHOICES } from "@/lib/delivery/correlated-cluster";
import {
  INSTRUMENT_CHOICES,
  SENSITIVE_RISK_FIELDS,
  sensitiveFieldsIn,
  validateSettings,
} from "../settings-validation";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("instrument choices", () => {
  it("[INVARIANT] are the registry's symbols, never a restated list", () => {
    expect([...INSTRUMENT_CHOICES]).toEqual([...REGISTRY_SYMBOLS]);
    expect(INSTRUMENT_CHOICES).toContain("USDJPY");
  });

  it("[INVARIANT] accepts a registry pair the old hardcoded trio refused", () => {
    const { patch, warnings } = validateSettings({ instruments: ["USDJPY", "XAUUSD"] });
    expect(patch["instruments"]).toEqual(["USDJPY", "XAUUSD"]);
    expect(warnings.join(" ")).not.toMatch(/USDJPY/);
  });

  it("[BEHAVIOR] still drops values that are not instruments at all", () => {
    const { warnings } = validateSettings({ instruments: ["NOTAPAIR"] });
    expect(warnings.join(" ")).toMatch(/NOTAPAIR/);
  });
});

describe("automatic-order rules, gates and brakes", () => {
  it("[INVARIANT] every one of them is a confirmation-gated field", () => {
    for (const field of [
      "maximum_concurrent_signal_orders",
      "maximum_daily_signal_orders",
      "maximum_daily_orders_per_symbol",
      "auto_order_window_minutes",
      "auto_market_entry_enabled",
      "auto_execute_c_grade",
      "auto_intel_gate_enabled",
      "auto_intel_min_expected_r",
      "max_entry_spread_pips",
      "max_total_exposure_percent",
      "drawdown_brakes_enabled",
      "consecutive_loss_limit",
      "consecutive_loss_pause_hours",
      "max_same_bet_orders",
      "same_bet_cooldown_minutes",
    ]) {
      expect(SENSITIVE_RISK_FIELDS as readonly string[]).toContain(field);
    }
    expect(sensitiveFieldsIn({ max_same_bet_orders: 3 })).toEqual(["max_same_bet_orders"]);
    expect(sensitiveFieldsIn({ drawdown_brakes_enabled: false })).toEqual([
      "drawdown_brakes_enabled",
    ]);
  });

  it("[INVARIANT] the same-bet limit clamps to 1-3 and warns when raised", () => {
    const high = validateSettings({ max_same_bet_orders: 9 });
    expect(high.patch["max_same_bet_orders"]).toBe(3);
    expect(high.warnings.join(" ")).toMatch(/clamped to 3/);
    expect(high.warnings.join(" ")).toMatch(/lose together/);

    const low = validateSettings({ max_same_bet_orders: 0 });
    expect(low.patch["max_same_bet_orders"]).toBe(1);

    const one = validateSettings({ max_same_bet_orders: 1 });
    expect(one.patch["max_same_bet_orders"]).toBe(1);
    expect(one.warnings.join(" ")).not.toMatch(/lose together/);
  });

  it("[INVARIANT] the same-bet cool-off only accepts its offered values and warns when off", () => {
    for (const minutes of SAME_BET_COOLDOWN_CHOICES) {
      expect(validateSettings({ same_bet_cooldown_minutes: minutes }).patch).toHaveProperty(
        "same_bet_cooldown_minutes",
        minutes,
      );
    }
    const bad = validateSettings({ same_bet_cooldown_minutes: 45 });
    expect(bad.patch["same_bet_cooldown_minutes"]).toBeUndefined();
    expect(bad.warnings.join(" ")).toMatch(/allowed values/);

    expect(validateSettings({ same_bet_cooldown_minutes: 0 }).warnings.join(" ")).toMatch(
      /immediately after a loss/,
    );
  });

  it("[INVARIANT] ceilings, window and pause length stay inside the app's bounds", () => {
    expect(validateSettings({ maximum_daily_signal_orders: 5000 }).patch).toHaveProperty(
      "maximum_daily_signal_orders",
      100,
    );
    expect(validateSettings({ auto_order_window_minutes: 99999 }).patch).toHaveProperty(
      "auto_order_window_minutes",
      600,
    );
    expect(validateSettings({ consecutive_loss_pause_hours: null }).patch).toHaveProperty(
      "consecutive_loss_pause_hours",
      null,
    );
    const odd = validateSettings({ consecutive_loss_pause_hours: 7 });
    expect(odd.patch["consecutive_loss_pause_hours"]).toBeUndefined();
    expect(odd.warnings.join(" ")).toMatch(/3, 5, or null/);
  });

  it("[INVARIANT] the adaptive band can never be written inverted", () => {
    const { patch, warnings } = validateSettings({
      adaptive_order_ceiling_max: 5,
      adaptive_order_ceiling_floor: 9,
    });
    expect(patch["adaptive_order_ceiling_max"]).toBe(5);
    expect(patch["adaptive_order_ceiling_floor"]).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/cannot exceed/);
  });
});

describe("get_my_settings and update_my_settings expose the whole surface", () => {
  const readTool = read("src/lib/mcp/tools/get-my-settings.ts");
  const writeTool = read("src/lib/mcp/tools/update-my-settings.ts");

  it("[INVARIANT] both cover the correlated-cluster brake and the order rules", () => {
    for (const field of [
      "max_same_bet_orders",
      "same_bet_cooldown_minutes",
      "auto_order_window_minutes",
      "consecutive_loss_limit",
      "auto_intel_min_expected_r",
      "max_total_exposure_percent",
    ]) {
      expect(readTool).toContain(field);
      expect(writeTool).toContain(field);
    }
  });

  it("[INVARIANT] webhook secrets are still never returned", () => {
    expect(readTool).not.toMatch(/webhook_secret|webhook_url/);
  });
});

describe("get_automatic_orders", () => {
  const src = read("src/lib/mcp/tools/get-automatic-orders.ts");

  it("[INVARIANT] reuses the app's own refusal wording", () => {
    expect(src).toMatch(/@\/lib\/delivery\/enqueue-log/);
    expect(src).toMatch(/describeEnqueueDecision/);
  });

  it("[INVARIANT] never lets an empty result become a scanner-wide verdict", () => {
    expect(src).toMatch(/not that the scanner is idle/);
    expect(src).not.toMatch(/Capital Preservation|No Trade/);
  });

  it("[INVARIANT] reads only as the signed-in user", () => {
    expect(src).toMatch(/supabaseForUser/);
    expect(src).not.toMatch(/supabaseAdmin|service_role/);
  });

  it("[INVARIANT] says a resting order is not a fill", () => {
    expect(src).toMatch(/is NOT a fill/);
  });
});

describe("get_risk_holds", () => {
  const src = read("src/lib/mcp/tools/get-risk-holds.ts");

  it("[INVARIANT] reports unknown, never 'not held', when the state cannot be read", () => {
    expect(src).toMatch(/status: "unknown"/);
    expect(src).toMatch(/NOT a statement that automatic orders are unheld/);
  });

  it("[INVARIANT] only reports a stored hold while the user's brakes are configured", () => {
    expect(src).toMatch(/brakesConfigured/);
    expect(src).toMatch(/readBrakeLimits/);
  });

  it("[INVARIANT] states that broker orders and positions are untouched", () => {
    expect(src).toMatch(/already at the broker are untouched/);
  });

  it("[INVARIANT] reads only as the signed-in user", () => {
    expect(src).toMatch(/supabaseForUser/);
    expect(src).not.toMatch(/supabaseAdmin|service_role/);
  });
});
