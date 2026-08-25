import { it, expect } from "vitest";
import { pendingLimitSideValid } from "@/lib/delivery/execution";
it("dbg", () => {
  console.log(pendingLimitSideValid({ action: "buy_limit", entry: 1.156 } as never, 1.15605, 0));
  expect(1).toBe(1);
});
