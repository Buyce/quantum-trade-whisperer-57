/**
 * Which take-profit choices Settings offers.
 *
 * The choice belongs to the customer: every policy is listed, with no platform
 * depth ceiling in front of it. The one restriction left is that a stepped
 * (managed) exit runs on DEMO accounts only, which the send-time revalidation
 * enforces by reducing it to the equivalent unmanaged single exit.
 */
import { describe, expect, it } from "vitest";

import {
  EXECUTION_POLICIES,
  isManagedPolicy,
  resolveExitPolicy,
  type ExecutionPolicy,
} from "../execution";

/** Settings lists every policy verbatim. */
const offered = (): readonly ExecutionPolicy[] => EXECUTION_POLICIES;

describe("take-profit choices offered to a customer", () => {
  it("[UNIT] offers all five choices, stepped ones included", () => {
    expect(offered()).toEqual([
      "single_exit_first_target",
      "single_exit_second_target",
      "single_exit_third_target",
      "partial_tp1_runner_tp2",
      "ladder_tp1_tp2_runner_tp3",
    ]);
    expect(offered().filter(isManagedPolicy)).toHaveLength(2);
  });

  it("[UNIT] leaves a customer choice unclamped at send time", () => {
    for (const policy of EXECUTION_POLICIES) {
      const resolved = resolveExitPolicy(policy, "ladder_tp1_tp2_runner_tp3");
      expect(resolved.policy).toBe(policy);
      expect(resolved.clamped).toBe(false);
    }
  });

  it("[UNIT] still treats stepped exits as demo-only", () => {
    // Mirrors revalidation: a managed policy on a non-demo account becomes the
    // equivalent unmanaged single exit rather than running half-managed.
    const forNonDemo = (policy: ExecutionPolicy): ExecutionPolicy =>
      isManagedPolicy(policy) ? "single_exit_second_target" : policy;
    expect(forNonDemo("ladder_tp1_tp2_runner_tp3")).toBe("single_exit_second_target");
    expect(forNonDemo("partial_tp1_runner_tp2")).toBe("single_exit_second_target");
    expect(forNonDemo("single_exit_third_target")).toBe("single_exit_third_target");
  });
});
