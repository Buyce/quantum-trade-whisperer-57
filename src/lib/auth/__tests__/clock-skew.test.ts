import { describe, expect, it } from "vitest";
import { shouldRetryQuery, friendlyLoadError } from "../clock-skew";

describe("clock skew retry", () => {
  it("[UNIT] retries 'JWT issued at future' up to 3 times", () => {
    const e = new Error("JWT issued at future");
    expect(shouldRetryQuery(0, e)).toBe(true);
    expect(shouldRetryQuery(2, e)).toBe(true);
    expect(shouldRetryQuery(3, e)).toBe(false);
  });
  it("[UNIT] never retries a real sign-in failure", () => {
    expect(shouldRetryQuery(0, new Error("Unauthorized: Invalid token"))).toBe(false);
  });
  it("[UNIT] shows plain words instead of the raw token error", () => {
    expect(friendlyLoadError(new Error("JWT issued at future"), "x")).toMatch(/not your account/);
  });
});

describe("real PostgREST error shape", () => {
  it("[UNIT] detects the plain-object PGRST303 'JWT not yet valid' error", () => {
    const e = { code: "PGRST303", details: null, hint: null, message: "JWT not yet valid" };
    expect(shouldRetryQuery(0, e)).toBe(true);
    expect(shouldRetryQuery(3, e)).toBe(false);
    expect(friendlyLoadError(e, "x")).toMatch(/not your account/);
  });
  it("[UNIT] does not treat an unrelated object error as clock skew", () => {
    expect(friendlyLoadError({ code: "42501", message: "permission denied" }, "x")).toBe("permission denied");
  });
});
