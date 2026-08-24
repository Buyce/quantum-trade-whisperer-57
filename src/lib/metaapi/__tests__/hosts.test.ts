import { describe, expect, it } from "vitest";
import { isTrustedMetaApiHost, isValidRegion, resolveHost } from "../hosts";

describe("metaapi host resolution", () => {
  it("[UNIT] resolves regional client and market-data hosts", () => {
    expect(resolveHost("client", "london")).toBe("https://mt-client-api-v1.london.agiliumtrade.ai");
    expect(resolveHost("market-data", "new-york")).toBe(
      "https://mt-market-data-client-api-v1.new-york.agiliumtrade.ai",
    );
  });

  it("[UNIT] resolves provisioning on the vendor's double-suffix domain", () => {
    expect(resolveHost("provisioning")).toBe(
      "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai",
    );
  });

  it("[UNIT] metastats and risk-management are region-scoped", () => {
    expect(resolveHost("metastats", "london")).toBe(
      "https://metastats-api-v1.london.agiliumtrade.ai",
    );
    expect(resolveHost("risk-management", "london")).toBe(
      "https://risk-management-api-v1.london.agiliumtrade.ai",
    );
    expect(resolveHost("metastats", null)).toBeNull();
    expect(resolveHost("risk-management", "LONDON")).toBeNull();
  });

  it("[INVARIANT] a regional host is never produced from a missing or malformed region", () => {
    for (const region of [
      null,
      undefined,
      "",
      "LONDON",
      "lon don",
      "london.evil.com",
      "london/../x",
      "-london",
      "london-",
      "a".repeat(33),
      "127.0.0.1",
      "attacker.example.com",
    ]) {
      expect(resolveHost("client", region as string | null)).toBeNull();
      expect(resolveHost("market-data", region as string | null)).toBeNull();
      expect(resolveHost("metastats", region as string | null)).toBeNull();
      expect(resolveHost("risk-management", region as string | null)).toBeNull();
    }
  });

  it("[INVARIANT] only hosts this resolver can produce are trusted", () => {
    expect(isTrustedMetaApiHost("https://mt-client-api-v1.london.agiliumtrade.ai")).toBe(true);
    expect(
      isTrustedMetaApiHost("https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai"),
    ).toBe(true);
    expect(isTrustedMetaApiHost("https://metastats-api-v1.london.agiliumtrade.ai")).toBe(true);
    // The non-resolving forms that produced the 530 / 1016 failure.
    expect(isTrustedMetaApiHost("https://mt-provisioning-api-v1.agiliumtrade.ai")).toBe(false);
    expect(isTrustedMetaApiHost("https://metastats-api-v1.agiliumtrade.ai")).toBe(false);
    expect(isTrustedMetaApiHost("http://mt-client-api-v1.london.agiliumtrade.ai")).toBe(false);
    expect(isTrustedMetaApiHost("https://evil.agiliumtrade.ai")).toBe(false);
    expect(isTrustedMetaApiHost("https://mt-client-api-v1.london.agiliumtrade.ai.evil.com")).toBe(
      false,
    );
    expect(isTrustedMetaApiHost("https://169.254.169.254")).toBe(false);
    expect(isTrustedMetaApiHost("not a url")).toBe(false);
  });

  it("[UNIT] region validation accepts documented shapes only", () => {
    expect(isValidRegion("singapore")).toBe(true);
    expect(isValidRegion("new-york")).toBe(true);
    expect(isValidRegion("new--york")).toBe(false);
    expect(isValidRegion(42)).toBe(false);
  });
});
