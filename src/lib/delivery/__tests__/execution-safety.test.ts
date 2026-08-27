/**
 * Prompt-13 closure regressions.
 *
 * These cover the four financial-safety properties that unit tests of the
 * individual helpers cannot prove on their own:
 *
 *  A. The DEFAULT controls (live disabled, dry-run forced) still produce a
 *     COMPLETE dry-run — full revalidation, quantity, signing — and zero
 *     outbound POSTs. A globally disabled system must be testable, not inert.
 *  B. The outgoing quantity is the authoritative sizing result, so two users
 *     with different equity/risk settings get different, correct volumes.
 *  C. A delivery is authorized by the configuration that enqueued it. Any change
 *     to destination, format, secret identity, dry/live authorization or a
 *     quantity-determining risk input rejects the queued order.
 *  D. Journal-derived exposure is advisory by default and blocks only after an
 *     explicit opt-in, always described as trades the user logged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBridgeOrder, validateQuantity, type BridgeSignal } from "../execution";
import { jsonBody } from "../dispatch.server";
import { resolveSizing } from "@/lib/broker/sizing.server";
import { riskProfileFromSettings } from "@/lib/risk";

// ---------------------------------------------------------------------------
// Module boundaries. Only genuinely external things are faked: broker quotes,
// DNS/SSRF resolution, the broker spec table and the Prompt-12 sizing service.
// Eligibility, market hours, the switches and the config binding are REAL.
// ---------------------------------------------------------------------------
const quote = vi.hoisted(() => ({ fn: vi.fn() }));
const sizing = vi.hoisted(() => ({ fn: vi.fn() }));
const spec = vi.hoisted(() => ({ fn: vi.fn() }));
const url = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("@/lib/scanner/metaapi.server", () => ({
  fetchQuote: (...a: unknown[]) => quote.fn(...a),
}));
vi.mock("@/lib/sizing/service.server", () => ({
  resolveSizingForUser: (...a: unknown[]) => sizing.fn(...a),
  resolveSizingForAccount: (...a: unknown[]) => sizing.fn(...a),
  isAccountSizingRefusal: (r: { available?: boolean; accountReason?: string }) =>
    r.available === false && typeof r.accountReason === "string",
}));
vi.mock("@/lib/broker/specs.server", () => ({
  loadBrokerSpec: (...a: unknown[]) => spec.fn(...a),
}));
vi.mock("../outbound-url.server", () => ({
  inspectUrlSyntax: () => ({ ok: true }),
  validateOutboundUrl: (...a: unknown[]) => url.fn(...a),
  URL_REJECTION_COPY: {},
}));

const { revalidateDelivery } = await import("../revalidate.server");
const { processNextDelivery } = await import("../dispatch.server");

// A Wednesday 12:00 UTC: London and New York are both open.
const NOW = Date.parse("2026-08-19T12:00:00.000Z");
const DETECTED = new Date(NOW - 5 * 60_000).toISOString();

const DEFAULT_CONTROLS = {
  // The shipped defaults: nothing may leave the system until an operator flips
  // both of these deliberately.
  live_execution_enabled: false,
  force_dry_run: true,
  disabled_bridges: [],
  disabled_instruments: [],
  allowed_live_hosts: ["bridge.example.com"],
  execution_policy: "single_exit_first_target",
};

const BASE_SETTINGS = {
  instruments: ["EURUSD"],
  sessions: ["London", "New York"],
  alert_min_grade: "B",
  daily_setup_cap: 0,
  execution_enabled: true,
  execution_dry_run: false,
  execution_config_version: 4,
  exposure_limit_enabled: false,
  webhook_enabled: true,
  webhook_url: "https://bridge.example.com/hook",
  webhook_secret: "sek",
  webhook_format: "json",
  webhook_validated_at: "2026-08-18T00:00:00.000Z",
};

const SIGNAL = {
  id: "sig-1",
  detected_at: DETECTED,
  instrument: "EURUSD",
  grade: "A",
  direction: "long",
  entry_price: 1.156,
  stop_loss: 1.155,
  tp1: 1.158,
  tp2: 1.159,
  tp3: null,
  max_r: 3,
  max_acceptable_entry: 1.15615,
  rr_ratio: 3,
  confidence_score: 82,
  status: "active",
  market_context: [{ trading_session: "London" }],
};

const SIZING_OK = {
  available: true as const,
  lots: 0.24,
  brokerVolumeCap: null,
  belowMinimumLot: false,
  exceedsMargin: false,
  exceedsStopCeiling: false,
  advisory: null,
  provenance: { authoritativeModel: 1 as const, specSource: "static_v1" as const, specAsOf: null },
};

interface Scenario {
  controls?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
  signal?: Record<string, unknown> | null;
}

/** A fake db covering exactly the chains revalidation and the frame page use. */
function fakeDb(s: Scenario = {}) {
  const controls = s.controls === undefined ? DEFAULT_CONTROLS : s.controls;
  const settings = s.settings === undefined ? BASE_SETTINGS : s.settings;
  const signal = s.signal === undefined ? SIGNAL : s.signal;
  const patches: Record<string, unknown>[] = [];

  const api = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain as never;
    Object.assign(chain, {
      select: () => self(),
      eq: () => self(),
      gte: () => self(),
      order: () => self(),
      range: async () => ({
        // The UTC-day frame: only this signal was detected today.
        data: table === "scanned_signals" && signal ? [signal] : [],
        error: null,
      }),
      maybeSingle: async () => ({
        data:
          table === "execution_controls"
            ? controls
            : table === "scanner_settings"
              ? settings
              : signal,
        error: null,
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          patches.push(patch);
          return { error: null };
        },
      }),
    });
    return chain;
  };

  return {
    patches,
    from: (table: string) => api(table),
    rpc: async () => ({ data: [], error: null }),
  };
}

const delivery = {
  id: 11,
  user_id: "u1",
  signal_id: "sig-1",
  bridge_profile: "primary",
  dry_run: false,
  execution_config_version: 4,
};

beforeEach(() => {
  quote.fn.mockResolvedValue({
    bid: 1.156,
    ask: 1.15605,
    sourceTime: new Date(NOW - 1_000).toISOString(),
    receivedAt: new Date(NOW).toISOString(),
  });
  sizing.fn.mockResolvedValue(SIZING_OK);
  spec.fn.mockResolvedValue(null);
  url.fn.mockResolvedValue({
    ok: true,
    url: "https://bridge.example.com/hook",
    host: "bridge.example.com",
    validatedAt: new Date(NOW).toISOString(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ===========================================================================
// A. Dry-run must work while live execution is globally disabled
// ===========================================================================
describe("A. global disable forces dry-run instead of disabling validation", () => {
  it("[INVARIANT] the shipped defaults produce a complete dry-run", async () => {
    const result = await revalidateDelivery(fakeDb() as never, delivery, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dryRun).toBe(true);
    expect(result.dryRunReason).toContain("disabled system-wide");
    // "Complete" means the whole contract was actually established, not skipped.
    expect(result.order.quantity.lots).toBe(0.24);
    expect(result.order.policy).toBe("single_exit_first_target");
    expect(result.destination).toBe("bridge_json");
    expect(result.endpoint?.host).toBe("bridge.example.com");
  });

  it("[INVARIANT] the default dry-run settles with zero outbound POSTs", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const db = fakeDb();
    (db as { rpc: unknown }).rpc = async () => ({ data: [delivery], error: null });

    const result = await processNextDelivery(db as never, NOW);
    expect(result).toMatchObject({ state: "acknowledged", dryRun: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    const settled = db.patches.at(-1)!;
    expect(settled["sent_at"]).toBeNull();
    expect(settled["payload_version"]).toBe(2);
    expect(String(settled["reason"])).toContain("disabled system-wide");
  });

  it("[INVARIANT] unreadable controls still fail closed", async () => {
    const result = await revalidateDelivery(fakeDb({ controls: null }) as never, delivery, NOW);
    expect(result).toMatchObject({ ok: false, reason: "live_execution_globally_disabled" });
  });

  it("[INVARIANT] an unverified bridge format stays dry-run-only", async () => {
    const db = fakeDb({
      controls: { ...DEFAULT_CONTROLS, live_execution_enabled: true, force_dry_run: false },
      settings: { ...BASE_SETTINGS, webhook_format: "pineconnector" },
    });
    const result = await revalidateDelivery(db as never, delivery, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dryRun).toBe(true);
    expect(result.dryRunReason).toContain("verified quantity contract");
  });

  it("[INVARIANT] the owner opt-in selects immediate market entry even when a limit could rest", async () => {
    const db = fakeDb({
      settings: { ...BASE_SETTINGS, auto_market_entry_enabled: true },
    });
    const result = await revalidateDelivery(db as never, delivery, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.entryMode).toBe("market");
    expect(result.order.action).toBe("buy");
    expect(result.plan.entryPrice).toBe(1.15605);
  });

  it("[INVARIANT] immediate market entry still refuses beyond the published ceiling", async () => {
    quote.fn.mockResolvedValue({
      bid: 1.1562,
      ask: 1.15625,
      sourceTime: new Date(NOW - 1_000).toISOString(),
      receivedAt: new Date(NOW).toISOString(),
    });
    const db = fakeDb({
      settings: { ...BASE_SETTINGS, auto_market_entry_enabled: true },
    });
    const result = await revalidateDelivery(db as never, delivery, NOW);
    expect(result).toMatchObject({ ok: false, reason: "price_beyond_max_acceptable_entry" });
  });
});

// ===========================================================================
// B. The authoritative quantity is what goes on the wire
// ===========================================================================
describe("B. authoritative position quantity in the execution contract", () => {
  const plan: BridgeSignal = {
    id: "sig-1",
    instrument: "EURUSD",
    grade: "A",
    direction: "long",
    entryPrice: 1.156,
    maxAcceptableEntry: 1.15615,
    stopLoss: 1.155,
    tp1: 1.158,
    tp2: 1.159,
    tp3: null,
    rrRatio: 3,
    confidence: 82,
  };

  function lotsFor(equity: number, riskPercent: number): number {
    const profile = riskProfileFromSettings({
      account_equity: equity,
      account_currency: "USD",
      risk_per_trade_percent: riskPercent,
      max_position_size: 50,
      leverage: 30,
      max_stop_loss_percent: 5,
    });
    const resolved = resolveSizing(
      {
        instrument: "EURUSD",
        entryPrice: plan.entryPrice,
        stopLoss: plan.stopLoss,
        finalTargetR: 3,
      },
      profile,
      { USD: 1 },
      { spec: null, v2Promoted: false, quoteStale: false, now: NOW },
    );
    if (!resolved.authoritative.ok) throw new Error("sizing unavailable in fixture");
    return resolved.authoritative.lots;
  }

  it("[INVARIANT] two users with different risk settings send different quantities", () => {
    const small = lotsFor(5_000, 1);
    const large = lotsFor(50_000, 2);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);

    const bodySmall = jsonBody(
      buildBridgeOrder(plan, {
        lots: small,
        sizingModel: 1,
        specSource: "static_v1",
        specAsOf: null,
      }),
      "sek",
      false,
    );
    const bodyLarge = jsonBody(
      buildBridgeOrder(plan, {
        lots: large,
        sizingModel: 1,
        specSource: "static_v1",
        specAsOf: null,
      }),
      "sek",
      false,
    );
    expect(bodySmall.quantity).toBe(small);
    expect(bodyLarge.quantity).toBe(large);
    expect(bodySmall.quantity).not.toBe(bodyLarge.quantity);
    // Provenance travels with the number so the receiver knows what produced it.
    expect(bodySmall.quantity_unit).toBe("lots");
    expect(bodySmall.quantity_sizing_model).toBe(1);
    expect(bodySmall.quantity_spec_source).toBe("static_v1");
  });

  it("[INVARIANT] an unavailable or invalid quantity is never invented", async () => {
    for (const bad of [null, 0, Number.NaN, -0.1]) {
      expect(
        validateQuantity(bad as number, {
          minLot: null,
          maxLot: null,
          lotStep: null,
          volumeCap: null,
        }).ok,
      ).toBe(false);
    }
    sizing.fn.mockResolvedValue({ ...SIZING_OK, lots: 0 });
    const result = await revalidateDelivery(fakeDb() as never, delivery, NOW);
    expect(result).toMatchObject({ ok: false, reason: "quantity_unavailable" });
  });

  it("[INVARIANT] a quantity outside broker min/max/step or the volume ceiling is refused", async () => {
    spec.fn.mockResolvedValue({ minLot: 0.1, maxLot: 5, lotStep: 0.1, contractSize: 100_000 });
    sizing.fn.mockResolvedValue({ ...SIZING_OK, lots: 0.24 }); // not a 0.1 step
    const stepped = await revalidateDelivery(fakeDb() as never, delivery, NOW);
    expect(stepped).toMatchObject({ ok: false, reason: "quantity_unavailable" });

    sizing.fn.mockResolvedValue({ ...SIZING_OK, lots: 2, brokerVolumeCap: 1 });
    const capped = await revalidateDelivery(fakeDb() as never, delivery, NOW);
    expect(capped).toMatchObject({ ok: false, reason: "quantity_unavailable" });
  });
});

// ===========================================================================
// C. Configuration binding
// ===========================================================================
describe("C. a delivery is bound to the configuration that authorized it", () => {
  // Every one of these changes bumps `execution_config_version` in the DB
  // trigger, so from the dispatcher's side they are one invariant: the queued
  // authorization no longer matches the current one.
  const changes = [
    ["endpoint URL", { webhook_url: "https://other.example.com/hook" }],
    ["bridge secret", { webhook_secret: "rotated" }],
    ["bridge format", { webhook_format: "pineconnector" }],
    ["dry/live authorization", { execution_dry_run: true }],
    ["risk profile inputs", { account_equity: 100_000 }],
  ] as const;

  for (const [label, patch] of changes) {
    it(`[INVARIANT] rejects when the ${label} changed after enqueue`, async () => {
      const db = fakeDb({
        settings: { ...BASE_SETTINGS, ...patch, execution_config_version: 5 },
      });
      const result = await revalidateDelivery(db as never, delivery, NOW);
      expect(result).toMatchObject({ ok: false, reason: "configuration_changed_since_enqueue" });
      if (!result.ok) expect(result.detail).toContain("v4");
    });
  }

  it("[INVARIANT] a missing configuration version fails closed", async () => {
    const noSnapshot = await revalidateDelivery(
      fakeDb() as never,
      { ...delivery, execution_config_version: null },
      NOW,
    );
    expect(noSnapshot).toMatchObject({ ok: false, reason: "configuration_changed_since_enqueue" });
  });

  it("[INVARIANT] an unchanged configuration is still authorized", async () => {
    const result = await revalidateDelivery(fakeDb() as never, delivery, NOW);
    expect(result.ok).toBe(true);
  });
});

// ===========================================================================
// D. Logged exposure is advisory by default
// ===========================================================================
describe("D. logged exposure is advisory unless the user opts in", () => {
  const overExposed = {
    ...SIZING_OK,
    advisory: { openRiskR: 2, pendingRiskR: 1, realizedLossTodayR: 0 },
  };

  it("[INVARIANT] an exceeded advisory alone does not reject the order", async () => {
    sizing.fn.mockResolvedValue(overExposed);
    const result = await revalidateDelivery(fakeDb() as never, delivery, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Reported, never silent — but not blocking.
    expect(result.exposure?.exceeded).toBe(true);
    expect(result.exposure?.enforced).toBe(false);
  });

  it("[INVARIANT] the same state rejects once the user opted in", async () => {
    sizing.fn.mockResolvedValue(overExposed);
    const db = fakeDb({ settings: { ...BASE_SETTINGS, exposure_limit_enabled: true } });
    const result = await revalidateDelivery(db as never, delivery, NOW);
    expect(result).toMatchObject({ ok: false, reason: "exposure_guardrail" });
    if (!result.ok) {
      expect(result.detail).toContain("trades you logged");
      expect(result.detail).toContain("not broker-account exposure");
    }
  });

  it("[INVARIANT] an empty journal is not treated as proof of zero broker exposure", async () => {
    // No advisory at all: the order proceeds on its own merits, and nothing
    // anywhere claims the user has no open broker position.
    sizing.fn.mockResolvedValue({ ...SIZING_OK, advisory: null });
    const db = fakeDb({ settings: { ...BASE_SETTINGS, exposure_limit_enabled: true } });
    const result = await revalidateDelivery(db as never, delivery, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.exposure).toBeNull();
  });
});
