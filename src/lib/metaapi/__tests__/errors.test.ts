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

  it("[INVARIANT] a token-scope refusal is a permission gap, not a credential or broker rejection", () => {
    const body =
      '{"id":13932,"error":"ForbiddenError","message":"You do not have access to trading-account-management-api:rest:public:account-management:createAccount method","details":{"methodId":["trading-account-management-api:rest:public:account-management:createAccount"]}}';
    const failure = classifyMetaApiFailure(new MetaApiHttpError(403, "create account", body));
    expect(failure.kind).toBe("permission");
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain("not allowed to create trading accounts");
    expect(failure.message).toContain("Nothing was created");
  });

  it("[INVARIANT] a non-creation permission refusal keeps the generic wording", () => {
    const body =
      '{"error":"ForbiddenError","message":"You do not have access to metastats-api:rest:public:metrics:getMetrics method"}';
    const failure = classifyMetaApiFailure(new MetaApiHttpError(403, "metastats metrics", body));
    expect(failure.kind).toBe("permission");
    expect(failure.message).toContain("not allowed to perform it");
  });

  it("[INVARIANT] a validation refusal names the rejected parameter instead of dumping vendor JSON", () => {
    const body =
      '{"id":19335,"error":"ValidationError","message":"Validation failed","details":[{"parameter":"state","value":"DRAFT","message":"Unexpected value."}]}';
    const failure = classifyMetaApiFailure(new MetaApiHttpError(400, "create account", body));
    expect(failure.kind).toBe("validation");
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain('does not accept for "state"');
    expect(failure.message).toContain("Nothing was created");
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
