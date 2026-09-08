/**
 * Which take-profit choices Settings may offer under a given platform ceiling.
 *
 * The Settings dropdown lists exactly the policies that resolve to themselves
 * under the ceiling, so these assertions are the contract behind "why is the
 * stepped choice not in my list".
 */
import { describe, expect, it } from "vitest";

import {
  EXECUTION_POLICIES,
  isManagedPolicy,
  resolveExitPolicy,
  type ExecutionPolicy,
} from "../execution";

const offered = (ceiling: ExecutionPolicy): ExecutionPolicy[] =>
  EXECUTION_POLICIES.filter((p) => resolveExitPolicy(p, ceiling).policy === p);

describe("take-profit choices offered under a ceiling", () => {
  it("offers no stepped choice while the ceiling names the third target", () => {
    const list = offered("single_exit_third_target");
    expect(list).toEqual([
      "single_exit_first_target",
      "single_exit_second_target",
      "single_exit_third_target",
    ]);
    expect(list.some(isManagedPolicy)).toBe(false);
  });

  it("offers both stepped choices once the ceiling names the ladder", () => {
    const list = offered("ladder_tp1_tp2_runner_tp3");
    expect(list).toContain("partial_tp1_runner_tp2");
    expect(list).toContain("ladder_tp1_tp2_runner_tp3");
  });

  it("offers the half-out choice but not the ladder at the shallower managed ceiling", () => {
    const list = offered("partial_tp1_runner_tp2");
    expect(list).toContain("partial_tp1_runner_tp2");
    expect(list).not.toContain("ladder_tp1_tp2_runner_tp3");
  });

  it("offers only the first target when the ceiling is unreadable", () => {
    expect(offered("not-a-policy" as ExecutionPolicy)).toEqual(["single_exit_first_target"]);
  });
});
