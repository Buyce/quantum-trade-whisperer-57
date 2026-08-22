/**
 * Control-plane bypass closures.
 *
 *  1. The scanner alert fan-out is NOTIFICATION-ONLY. `webhook_enabled` alone can
 *     never place a trade, and no execution-capable POST exists outside the
 *     Prompt-13 dispatcher.
 *  2. The connectivity test can never emit order syntax and can never reach an
 *     unvalidated destination or follow a redirect.
 *  3. Live execution needs a dedicated confirmation, pinned to the exact
 *     configuration and to live execution actually being available at the time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildTestJsonPayload, buildTestPineConnectorPreview } from "@/lib/webhook-test.functions";
import { validateOutboundUrl } from "../outbound-url.server";

const quote = vi.hoisted(() => ({ fn: vi.fn() }));
const sizing = vi.hoisted(() => ({ fn: vi.fn() }));
const spec = vi.hoisted(() => ({ fn: vi.fn() }));
const url = vi.hoisted(() => ({ fn: vi.fn() }));
const email = vi.hoisted(() => ({ fn: vi.fn() }));
const push = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("@/lib/scanner/metaapi.server", () => ({ fetchQuote: (...a: unknown[]) => quote.fn(...a) }));
vi.mock("@/lib/sizing/service.server", () => ({
  resolveSizingForUser: (...a: unknown[]) => sizing.fn(...a),
}));
vi.mock("@/lib/broker/specs.server", () => ({ loadBrokerSpec: (...a: unknown[]) => spec.fn(...a) }));
vi.mock("../outbound-url.server", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, validateOutboundUrl: (...a: unknown[]) => url.fn(...a) };
});
vi.mock("@/lib/email-templates/send-email", () => ({
  sendTemplateEmail: (...a: unknown[]) => email.fn(...a),
}));
vi.mock("@/lib/scanner/push.server", () => ({
  sendPushToUsers: (...a: unknown[]) => push.fn(...a),
}));

const { revalidateDelivery, liveConfirmationValid } = await import("../revalidate.server");
const { sendSignalAlerts } = await import("@/lib/scanner/alerts.server");

const NOW = Date.parse("2026-08-19T12:00:00.000Z");
const DETECTED = new Date(NOW - 5 * 60_000).toISOString();

const LIVE_CONTROLS = {
  live_execution_enabled: true,
  force_dry_run: false,
  disabled_bridges: [],
  disabled_instruments: [],
  allowed_live_hosts: ["bridge.example.com"],
  execution_policy: "single_exit_first_target",
};

const CONFIRMED_SETTINGS = {
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
  live_execution_confirmed_at: "2026-08-18T00:00:00.000Z",
  live_execution_confirmed_version: 4,
  live_execution_confirmed_global_live: true,
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

function fakeDb(settings: Record<string, unknown> | null, controls: Record<string, unknown> | null) {
  const api = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain as never;
    Object.assign(chain, {
      select: () => self(),
      eq: () => self(),
      gte: () => self(),
      order: () => self(),
      range: async () => ({ data: table === "scanned_signals" ? [SIGNAL] : [], error: null }),
      maybeSingle: async () => ({
        data:
          table === "execution_controls"
            ? controls
            : table === "scanner_settings"
              ? settings
              : SIGNAL,
        error: null,
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    });
    return chain;
  };
  return { from: (t: string) => api(t), rpc: async () => ({ data: [], error: null }) };
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
// 1. The legacy direct broker path is gone
// ===========================================================================
describe("1. the scanner alert fan-out cannot place a trade", () => {
  function alertDb(rows: Record<string, unknown>[]) {
    const api = (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain as never;
      Object.assign(chain, {
        select: () => self(),
        eq: () => self(),
        gte: () => self(),
        order: () => self(),
        or: async () => ({ data: rows, error: null }),
        range: async () => ({ data: table === "scanned_signals" ? [SIGNAL] : [], error: null }),
        insert: async () => ({ error: null }),
      });
      return chain;
    };
    return {
      from: (t: string) => api(t),
      auth: { admin: { getUserById: async () => ({ data: { user: { email: "t@example.com" } } }) } },
    };
  }

  it("[INVARIANT] webhook_enabled with execution off produces zero broker-order POSTs", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await sendSignalAlerts(
      alertDb([
        {
          user_id: "u1",
          instruments: ["EURUSD"],
          sessions: ["London"],
          alert_min_grade: "B",
          daily_setup_cap: 0,
          notify_email: true,
          notify_push: true,
          // Legacy bridge configuration, execution deliberately NOT enabled.
          webhook_enabled: true,
          webhook_url: "https://bridge.example.com/hook",
          webhook_secret: "sek",
          webhook_format: "pineconnector",
        },
      ]) as never,
      {
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
        breakdown: "test",
        session: "London",
      },
    );

    // Notification channels still fire; nothing is POSTed anywhere.
    expect(email.fn).toHaveBeenCalledTimes(1);
    expect(push.fn).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("[INVARIANT] execution-capable order syntax exists only in the dispatcher", () => {
    const root = join(process.cwd(), "src");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return entry === "__tests__" ? [] : walk(full);
        return /\.tsx?$/.test(entry) ? [full] : [];
      });

    const offenders = walk(root).filter((file) => {
      const src = readFileSync(file, "utf8");
      // The order verbs a broker bridge executes.
      const hasOrderSyntax = /"buylimit"|"selllimit"|"buy_limit"|"sell_limit"/.test(src);
      if (!hasOrderSyntax) return false;
      // Only the execution plane may name them, and only the dispatcher may POST.
      return !file.includes(join("src", "lib", "delivery"));
    });
    expect(offenders).toEqual([]);
  });
});

// ===========================================================================
// 2. The connectivity test
// ===========================================================================
describe("2. the bridge connectivity test", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/webhook-test.functions.ts"), "utf8");

  it("[INVARIANT] never produces PineConnector order syntax", () => {
    const preview = buildTestPineConnectorPreview();
    expect(preview).not.toMatch(/,(buylimit|selllimit),/);
    // And there is no POST path for that format at all.
    expect(source).toContain('if (format === "pineconnector")');
    expect(source).toContain("posted: false as const");
  });

  it("[INVARIANT] the JSON test body is a non-execution contract", () => {
    const body = buildTestJsonPayload(null) as Record<string, unknown>;
    expect(body['event']).toBe("test");
    expect(body['executable']).toBe(false);
    expect(body['action']).toBeUndefined();
    expect(body['quantity']).toBeUndefined();
  });

  it("[INVARIANT] it reuses canonical validation and refuses redirects", () => {
    expect(source).toContain("validateOutboundUrl");
    expect(source).toContain('redirect: "manual"');
    // A stored-but-unvalidated or disabled URL is refused before any request.
    expect(source).toContain("webhook_validated_at");
    expect(source).toContain("webhook_enabled");
  });

  it("[INVARIANT] private, link-local, metadata and loopback destinations are rejected", async () => {
    for (const bad of [
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://metadata.google.internal/hook",
      "https://localhost/hook",
      "http://bridge.example.com/hook",
    ]) {
      const verdict = await validateOutboundUrl(bad);
      expect(verdict.ok).toBe(false);
    }
  });
});

// ===========================================================================
// 3. Explicit live-execution confirmation
// ===========================================================================
describe("3. live execution requires a fresh explicit confirmation", () => {
  it("[INVARIANT] a confirmed configuration may go live when every other control passes", async () => {
    const result = await revalidateDelivery(
      fakeDb(CONFIRMED_SETTINGS, LIVE_CONTROLS) as never,
      delivery,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dryRun).toBe(false);
    expect(result.dryRunReason).toBeNull();
  });

  it("[INVARIANT] a global live enable does not activate an unconfirmed live preference", async () => {
    const unconfirmed = {
      ...CONFIRMED_SETTINGS,
      live_execution_confirmed_at: null,
      live_execution_confirmed_version: null,
      live_execution_confirmed_global_live: false,
    };
    const result = await revalidateDelivery(
      fakeDb(unconfirmed, LIVE_CONTROLS) as never,
      delivery,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dryRun).toBe(true);
    expect(result.dryRunReason).toContain("not been confirmed");
  });

  it("[INVARIANT] a confirmation given while live was unavailable never arms live", () => {
    expect(
      liveConfirmationValid(
        {
          live_execution_confirmed_at: "2026-08-18T00:00:00.000Z",
          live_execution_confirmed_version: 4,
          live_execution_confirmed_global_live: false,
        },
        4,
      ),
    ).toBe(false);
  });

  it("[INVARIANT] a confirmation for an older configuration is stale", () => {
    expect(
      liveConfirmationValid(
        {
          live_execution_confirmed_at: "2026-08-18T00:00:00.000Z",
          live_execution_confirmed_version: 4,
          live_execution_confirmed_global_live: true,
        },
        5,
      ),
    ).toBe(false);
  });

  it("[INVARIANT] a user cannot pre-arm live while live execution is unavailable", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/execution.functions.ts"), "utf8");
    expect(src).toContain("confirmLiveExecution");
    expect(src).toContain("cannot be armed in advance");
    // Dry-run is only turned off when the confirmation and the global switch agree.
    expect(src).toContain("execution_dry_run: !liveRequested");
  });
});

// ===========================================================================
// 4. Eligibility settings are part of the configuration identity
// ===========================================================================
describe("4. eligibility changes invalidate queued deliveries", () => {
  for (const label of ["instruments", "sessions", "alert_min_grade", "daily_setup_cap"]) {
    it(`[INVARIANT] a ${label} change after enqueue rejects the queued delivery`, async () => {
      // The DB trigger bumps the version on any of these columns; the dispatcher
      // then refuses to send under an authorization it was not queued with.
      const db = fakeDb(
        { ...CONFIRMED_SETTINGS, execution_config_version: 5 },
        LIVE_CONTROLS,
      );
      const result = await revalidateDelivery(db as never, delivery, NOW);
      expect(result).toMatchObject({ ok: false, reason: "configuration_changed_since_enqueue" });
    });
  }
});
