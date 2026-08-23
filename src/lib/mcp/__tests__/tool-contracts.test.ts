/**
 * Prompt 11 — MCP financial-safety contracts.
 *  - grade filtering happens in SQL, before the row limit;
 *  - the default list scope stays `all_published` (no silent contract change);
 *  - risk-profile writes require explicit user confirmation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SENSITIVE_RISK_FIELDS, sensitiveFieldsIn, validateSettings } from "../settings-validation";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("list_signals", () => {
  const src = read("src/lib/mcp/tools/list-signals.ts");

  it("[INVARIANT] applies min_grade in SQL before the limit", () => {
    const inIndex = src.indexOf('query.in("grade"');
    const limitIndex = src.indexOf(".limit(");
    expect(inIndex).toBeGreaterThan(0);
    expect(inIndex).toBeLessThan(limitIndex);
    // No post-limit grade rank filtering left over.
    expect(src).not.toMatch(/GRADE_RANK/);
  });

  it("[INVARIANT] defaults to the all_published scope and keeps resolved rows", () => {
    expect(src).toMatch(/scope \?\? "all_published"/);
    // No status filter anywhere: historical/resolved setups stay listable.
    expect(src).not.toMatch(/eq\("status"/);
  });

  it("[INVARIANT] my_scanner reuses the shared eligibility module", () => {
    expect(src).toMatch(/@\/lib\/delivery\/eligibility/);
    expect(src).toMatch(/evaluateEligibility/);
    expect(src).toMatch(/buildCapFrame/);
  });
});

describe("update_my_settings risk confirmation", () => {
  const src = read("src/lib/mcp/tools/update-my-settings.ts");

  it("[UNIT] the sensitive set is exactly the money-moving fields", () => {
    expect([...SENSITIVE_RISK_FIELDS]).toEqual([
      "account_equity",
      "account_currency",
      "risk_per_trade_percent",
      "max_position_size",
      "leverage",
      "max_stop_loss_percent",
      "risk_ack_high",
    ]);
    expect(sensitiveFieldsIn({ min_grade: "A" })).toEqual([]);
    expect(sensitiveFieldsIn({ leverage: 200, notify_push: true })).toEqual(["leverage"]);
  });

  it("[INVARIANT] the tool refuses unconfirmed risk writes before any mutation", () => {
    const guard = src.indexOf("confirm_risk_change !== true");
    const update = src.indexOf('.from("scanner_settings")');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(update);
  });

  it("[INVARIANT] the contract states the flag means explicit user approval", () => {
    expect(src).toMatch(/explicitly approved/);
    expect(src).toMatch(/does not relax validation or clamping/);
  });

  it("[UNIT] confirmation does not bypass clamping", () => {
    const { patch, warnings } = validateSettings({ leverage: 9000 });
    expect(patch["leverage"]).toBe(500);
    expect(warnings.length).toBe(1);
  });

  it("[INVARIANT] risk above 2% is left unchanged without a high-risk acknowledgement", () => {
    const { patch, warnings } = validateSettings({ risk_per_trade_percent: 5 });
    expect(patch["risk_per_trade_percent"]).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/high-risk acknowledgement/);
  });

  it("[UNIT] an acknowledged high risk is applied and the acknowledgement persisted", () => {
    const fresh = validateSettings({ risk_per_trade_percent: 5, risk_ack_high: true });
    expect(fresh.patch["risk_per_trade_percent"]).toBe(5);
    expect(fresh.patch["risk_ack_high"]).toBe(true);
    // A previously stored acknowledgement also counts.
    const stored = validateSettings({ risk_per_trade_percent: 500 }, { currentAckHigh: true });
    expect(stored.patch["risk_per_trade_percent"]).toBe(10);
  });

  it("[INVARIANT] the acknowledgement cannot be cleared while stored risk stays above 2%", () => {
    const { patch, warnings } = validateSettings(
      { risk_ack_high: false },
      { currentAckHigh: true, currentRiskPercent: 5 },
    );
    expect(patch["risk_ack_high"]).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/cannot be cleared/);
  });

  it("[UNIT] clearing the acknowledgement is allowed when the same update lowers risk to 2% or less", () => {
    const { patch } = validateSettings(
      { risk_ack_high: false, risk_per_trade_percent: 1 },
      { currentAckHigh: true, currentRiskPercent: 5 },
    );
    expect(patch["risk_ack_high"]).toBe(false);
    expect(patch["risk_per_trade_percent"]).toBe(1);
  });
});

describe("calculate_position_size", () => {
  const src = read("src/lib/mcp/tools/calculate-position-size.ts");

  it("[INVARIANT] no fixed FX symbol list is fetched on every call", () => {
    expect(src).not.toMatch(/\["AUDUSD", "GBPUSD"\]/);
    // Conversion legs are resolved on demand inside the shared server service.
    expect(src).toMatch(/resolveSizingForUser/);
  });

  it("[INVARIANT] does not touch the scanner's own MetaApi candle path", () => {
    expect(src).not.toMatch(/fetchCandles/);
  });
});
