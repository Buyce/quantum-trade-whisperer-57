import { describe, expect, it } from "vitest";
import { describeError } from "../describe";
describe("describeError", () => {
  it("[UNIT] keeps the database error code and message instead of [object Object]", () => {
    expect(describeError({ code: "PGRST303", message: "JWT issued at future" })).toBe("PGRST303: JWT issued at future");
  });
  it("[UNIT] keeps Error messages", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });
});
