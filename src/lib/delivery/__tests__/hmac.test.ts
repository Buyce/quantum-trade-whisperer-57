import { describe, expect, it } from "vitest";
import {
  PAYLOAD_VERSION,
  hmacSha256Hex,
  requestFingerprint,
  signBody,
  signingBase,
} from "../hmac";
import { jsonBody, pineBody, readOrderId } from "../dispatch.server";
import { buildBridgeOrder, type BridgeSignal } from "../execution";

const signal: BridgeSignal = {
  id: "s1",
  instrument: "EURUSD",
  grade: "A",
  direction: "long",
  entryPrice: 1.156,
  maxAcceptableEntry: 1.15615,
  stopLoss: 1.155,
  tp1: 1.157,
  tp2: 1.158,
  tp3: 1.159,
  rrRatio: 3,
  confidence: 82,
};

describe("signing", () => {
  it("binds timestamp and nonce into the signed material", () => {
    expect(signingBase("100", "n1", "{}")).toBe("100.n1.{}");
  });

  it("is deterministic for fixed inputs and changes with the nonce", async () => {
    const a = await signBody("secret", "{}", { timestamp: "100", nonce: "n1" });
    const b = await signBody("secret", "{}", { timestamp: "100", nonce: "n1" });
    const c = await signBody("secret", "{}", { timestamp: "100", nonce: "n2" });
    expect(a["X-PTrades-Signature"]).toBe(b["X-PTrades-Signature"]);
    expect(a["X-PTrades-Signature"]).not.toBe(c["X-PTrades-Signature"]);
    expect(a["X-PTrades-Payload-Version"]).toBe(String(PAYLOAD_VERSION));
  });

  it("matches a known HMAC-SHA256 vector", async () => {
    expect(await hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog")).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });

  it("produces a stable non-secret fingerprint", async () => {
    const f = await requestFingerprint("{}", "n1");
    expect(f).toHaveLength(32);
    expect(f).toBe(await requestFingerprint("{}", "n1"));
    expect(f).not.toBe(await requestFingerprint("{}", "n2"));
  });
});

describe("payloads", () => {
  it("json payload carries version 2, the policy and the slippage ceiling", () => {
    const body = jsonBody(buildBridgeOrder(signal), "sek", false);
    expect(body.payload_version).toBe(2);
    expect(body.secret).toBe("sek");
    expect(body.execution_policy).toBe("single_exit_first_target");
    expect(body.max_acceptable_entry).toBe(signal.maxAcceptableEntry);
    expect(body.take_profit).toBe(signal.tp1);
    expect(body.dry_run).toBe(false);
  });

  it("pineconnector payload is a single comma line with a limit action", () => {
    const line = pineBody(buildBridgeOrder(signal), "LIC1");
    expect(line.startsWith("LIC1,buylimit,EURUSD,")).toBe(true);
    expect(line).toContain("expiration=30");
  });
});

describe("acknowledgement reading", () => {
  it("accepts a broker order id in any of the common shapes", () => {
    expect(readOrderId('{"order_id":"123"}')).toBe("123");
    expect(readOrderId('{"ticket":98765}')).toBe("98765");
  });

  it("treats a 200 HTML error page as unacknowledged", () => {
    expect(readOrderId("<html>error</html>")).toBeNull();
    expect(readOrderId('{"status":"ok"}')).toBeNull();
  });
});
