import { describe, expect, it } from "vitest";

import {
  isPasswordlessAccount,
  recoveryState,
  validateNewPassword,
  PASSWORD_MAX_LENGTH,
} from "../password";

describe("[UNIT] password rules", () => {
  it("refuses a short password before comparing the confirmation", () => {
    const result = validateNewPassword("short", "different");
    expect(result).toEqual({ ok: false, message: "Password must be at least 8 characters" });
  });

  it("refuses a password beyond the bcrypt limit", () => {
    const result = validateNewPassword("a".repeat(PASSWORD_MAX_LENGTH + 1), "a");
    expect(result.ok).toBe(false);
  });

  it("refuses a mismatched confirmation", () => {
    expect(validateNewPassword("correct-horse", "correct-hors")).toEqual({
      ok: false,
      message: "The two passwords do not match",
    });
  });

  it("accepts a valid matching pair", () => {
    expect(validateNewPassword("correct-horse", "correct-horse")).toEqual({ ok: true });
  });

  it("treats a Google-only account as passwordless", () => {
    expect(isPasswordlessAccount(["google"])).toBe(true);
    expect(isPasswordlessAccount(["google", "email"])).toBe(false);
    expect(isPasswordlessAccount([])).toBe(false);
  });

  it("only calls a recovery link expired once the session check finished", () => {
    expect(recoveryState(false, false)).toBe("waiting");
    expect(recoveryState(false, true)).toBe("expired");
    expect(recoveryState(true, true)).toBe("ready");
  });
});
