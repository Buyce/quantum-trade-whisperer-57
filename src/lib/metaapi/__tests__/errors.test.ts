import { describe, expect, it } from "vitest";
import {
  classifyMetaApiFailure,
  MetaApiHttpError,
  MetaApiNotConfiguredError,
  MetaApiTimeoutError,
} from "../errors";

describe("metaapi failure classification", () => {
  it("[UNIT] timeouts and missing configuration are non-retryable", () => {
    expect(classifyMetaApiFailure(new MetaApiTimeoutError("XAUUSD H4"))).toMatchObject({
      kind: "timeout",
      retryable: false,
    });
    expect(classifyMetaApiFailure(new MetaApiNotConfiguredError())).toMatchObject({
      kind: "not_configured",
      retryable: false,
    });
  });

  it("[INVARIANT] a provider billing refusal is classified as such, not as auth or validation", () => {
    expect(
      classifyMetaApiFailure(
        new MetaApiHttpError(401, "candles", "Please top up your account balance"),
      ).kind,
    ).toBe("provider_billing");
    expect(
      classifyMetaApiFailure(new MetaApiHttpError(400, "candles", "payment required")).kind,
    ).toBe("provider_billing");
  });

  it("[UNIT] maps auth, feature, not-found, validation and server statuses", () => {
    expect(classifyMetaApiFailure(new MetaApiHttpError(403, "x", "forbidden")).kind).toBe("auth");
    expect(
      classifyMetaApiFailure(new MetaApiHttpError(403, "x", "MetaStats API is not enabled")).kind,
    ).toBe("feature_not_enabled");
    expect(classifyMetaApiFailure(new MetaApiHttpError(404, "x", "no account")).kind).toBe(
      "not_found",
    );
    expect(classifyMetaApiFailure(new MetaApiHttpError(400, "x", "bad volume")).kind).toBe(
      "validation",
    );
    expect(classifyMetaApiFailure(new MetaApiHttpError(503, "x", "down")).retryable).toBe(true);
  });

  it("[UNIT] preserves retry-after for processing and rate limiting", () => {
    expect(classifyMetaApiFailure(new MetaApiHttpError(202, "metrics", "wait", 30))).toMatchObject({
      kind: "processing",
      retryAfterSeconds: 30,
      retryable: true,
    });
    expect(classifyMetaApiFailure(new MetaApiHttpError(429, "metrics", "slow down", 5))).toMatchObject(
      { kind: "rate_limited", retryAfterSeconds: 5, retryable: true },
    );
  });

  it("[INVARIANT] an unexpected thrown value is unknown and never retryable", () => {
    expect(classifyMetaApiFailure("boom")).toMatchObject({ kind: "unknown", retryable: false });
  });

  it("[INVARIANT] error bodies are truncated so vendor payloads cannot flood logs", () => {
    const err = new MetaApiHttpError(500, "x", "y".repeat(5000));
    expect(err.body.length).toBe(300);
  });
});
