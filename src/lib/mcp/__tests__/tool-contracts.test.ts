/**
 * Prompt 11 — MCP financial-safety contracts.
 *  - grade filtering happens in SQL, before the row limit;
 *  - the default list scope stays `all_published` (no silent contract change);
 *  - risk-profile writes require explicit user confirmation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SENSITIVE_RISK_FIELDS,
  sensitiveFieldsIn,
  validateSettings,
} from "../settings-validation";

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
    const { patch, warnings } = validateSettings({ risk_per_trade_percent: 500, leverage: 9000 });
    expect(patch["risk_per_trade_percent"]).toBe(10);
    expect(patch["leverage"]).toBe(500);
    expect(warnings.length).toBe(2);
  });
});

describe("calculate_position_size", () => {
  const src = read("src/lib/mcp/tools/calculate-position-size.ts");

  it("[INVARIANT] no fixed FX symbol list is fetched on every call", () => {
    expect(src).not.toMatch(/\["AUDUSD", "GBPUSD"\]/);
    expect(src).toMatch(/planConversion/);
    expect(src).toMatch(/resolveConversionRates/);
  });

  it("[INVARIANT] does not touch the scanner's own MetaApi candle path", () => {
    expect(src).not.toMatch(/fetchCandles/);
  });
});
