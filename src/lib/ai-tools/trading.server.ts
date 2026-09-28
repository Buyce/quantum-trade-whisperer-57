/**
 * AI trading sessions — executors.
 *
 * An outside AI app (MCP) or the in-app assistant can place, change and close
 * trades and arm accounts ONLY inside a session the signed-in user approved on
 * P-Trades (`ai_trading_grants`). Every call re-checks the session and then
 * reuses the platform's existing pieces:
 *   - Runtime Validation's nine gates (connection, fresh broker facts,
 *     permissions, risk policy incl. daily-loss/trade limits, symbol mapping,
 *     fresh quote/spec, broker-derived sizing, margin, reconciliation) run on
 *     every new order. Size ALWAYS comes from that sizing, never from the AI.
 *   - cohort block/reduce rules, the high-impact news blackout, emergency
 *     stops and the system-wide live switch.
 *   - broker calls from src/lib/metaapi/trade.server.ts and arming via
 *     src/lib/accounts/arm.server.ts.
 * Every action is written to ai_trade_actions. UNKNOWN broker verdicts are
 * recorded as unknown and never resent.
 */
import type { TradeVerdict } from "@/lib/metaapi/trade-result";
import { envelope, type Envelope } from "./bodies";
import {
  armInput,
  closePositionInput,
  grantAllows,
  modifyOrderInput,
  modifyPositionInput,
  placeOrderInput,
  protectionOk,
  scaleLots,
  type Grant,
  type GrantAction,
} from "./trading";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface TradingDeps {
  admin: () => Promise<Db>;
  runValidation: (db: Db, input: { accountId: string; symbol: string; direction: "long" | "short"; stopDistance: number }) => Promise<{
    passed: boolean;
    lots: number | null;
    risk_percent: number | null;
    broker_symbol: string | null;
    gates: { gate: string; status: string; reason: string | null }[];
  }>;
  resolveBrokerSymbol: (db: Db, accountId: string, canonical: string, server: string | null) => Promise<string | null>;
  quote: (metaId: string, region: string, symbol: string) => Promise<{ bid: number; ask: number } | null>;
  spec: (db: Db, accountId: string, canonical: string) => Promise<{ lotStep: number; minLot: number } | null>;
  positions: (metaId: string, region: string) => Promise<{ id?: string | null; type?: string | null; volume?: number | null; currentPrice?: number | null; takeProfit?: number | null; stopLoss?: number | null }[]>;
  orders: (metaId: string, region: string) => Promise<{ id?: string | null; type?: string | null }[]>;
  submitMarket: (metaId: string, region: string, o: never) => Promise<TradeVerdict>;
  submitPending: (metaId: string, region: string, o: never) => Promise<TradeVerdict>;
  modifyPosition: (metaId: string, region: string, positionId: string, sl: number, tp?: number) => Promise<TradeVerdict>;
  closeFull: (metaId: string, region: string, positionId: string) => Promise<TradeVerdict>;
  closePartial: (metaId: string, region: string, positionId: string, volume: number) => Promise<TradeVerdict>;
  modifyOrder: (metaId: string, region: string, orderId: string, entry: number, sl: number, tp: number) => Promise<TradeVerdict>;
  arm: (userId: string, accountId: string, mode: string) => Promise<{ mode: string }>;
  now: () => number;
}

export const defaultTradingDeps: TradingDeps = {
  admin: async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin,
  runValidation: async (db, input) => (await import("@/lib/validation/runtime.server")).runRuntimeValidation(db, input),
  resolveBrokerSymbol: async (db, accountId, canonical, server) => {
    const { resolveMapping } = await import("@/lib/instruments/mapping.server");
    const m = await resolveMapping(db, { canonical, accountId, server, now: new Date() });
    return m.usable ? m.providerSymbol : null;
  },
  quote: async (a, r, s) => (await import("@/lib/metaapi/market.server")).fetchQuoteFor(a, r, s),
  spec: async (db, a, c) => (await import("@/lib/accounts/specs.server")).loadAccountSizingSpec(db, a, c),
  positions: async (a, r) => (await import("@/lib/metaapi/accounts.server")).fetchPositions(a, r),
  orders: async (a, r) => (await import("@/lib/metaapi/accounts.server")).fetchOrders(a, r),
  submitMarket: async (a, r, o) => (await import("@/lib/metaapi/trade.server")).submitMarketOrder(a, r, o),
  submitPending: async (a, r, o) => (await import("@/lib/metaapi/trade.server")).submitPendingOrder(a, r, o),
  modifyPosition: async (a, r, p, sl, tp) => (await import("@/lib/metaapi/trade.server")).modifyPositionProtection(a, r, p, sl, tp),
  closeFull: async (a, r, p) => (await import("@/lib/metaapi/trade.server")).closePositionById(a, r, p),
  closePartial: async (a, r, p, v) => (await import("@/lib/metaapi/trade.server")).partialClosePosition(a, r, p, v),
  modifyOrder: async (a, r, o, e, sl, tp) => (await import("@/lib/metaapi/trade.server")).modifyPendingOrder(a, r, o, e, sl, tp),
  arm: async (u, a, m) => (await import("@/lib/accounts/arm.server")).setAccountMode(u, a, m),
  now: () => Date.now(),
};

const fail = (message: string) => envelope({ error: message, nothing_sent_to_broker: true }, true);

interface AccountRow {
  id: string;
  label: string | null;
  metaapi_account_id: string | null;
  region: string | null;
  magic: number | null;
  broker_account_type: string | null;
  intent: string | null;
  emergency_stop_at: string | null;
  disconnected_at: string | null;
  broker_server: string | null;
}

interface Ctx {
  admin: Db;
  account: AccountRow;
  grant: Grant;
  isLive: boolean;
}

/** Load grant + account and apply every session-level rule. */
async function authorize(
  deps: TradingDeps,
  userId: string,
  clientId: string,
  accountId: string,
  action: GrantAction,
): Promise<Ctx | Envelope> {
  const admin = await deps.admin();
  const nowIso = new Date(deps.now()).toISOString();
  const [{ data: grants }, { data: account }, { data: controls }] = await Promise.all([
    admin
      .from("ai_trading_grants")
      .select("*")
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .is("revoked_at", null)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(1),
    admin
      .from("connected_trading_accounts")
      .select("id, label, metaapi_account_id, region, magic, broker_account_type, intent, emergency_stop_at, disconnected_at, broker_server")
      .eq("id", accountId)
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("execution_controls").select("live_execution_enabled").eq("id", true).maybeSingle(),
  ]);
  if (!account) return fail("That account was not found among your accounts.");
  const a = account as AccountRow;
  const isLive = a.broker_account_type === "real" || a.intent === "live";
  const grant = ((grants ?? [])[0] ?? null) as Grant | null;
  const check = grantAllows(grant, { action, accountId, isLive, clientId, now: deps.now() });
  if (!check.ok) return fail(check.reason);
  if (a.disconnected_at) return fail("That account is disconnected.");
  if (a.emergency_stop_at && action !== "close") return fail("The emergency stop is on for this account. Only closing positions is allowed.");
  if (isLive && action !== "close" && (controls as { live_execution_enabled?: boolean } | null)?.live_execution_enabled !== true)
    return fail("Live execution is switched off system-wide.");
  if (!a.metaapi_account_id || !a.region) return fail("This account has no broker connection.");
  return { admin, account: a, grant: grant as Grant, isLive };
}

async function logAction(
  admin: Db,
  row: {
    grant_id: string | null;
    user_id: string;
    account_id: string;
    account_type: string;
    action: string;
    request: unknown;
    outcome: string;
    detail?: string | null;
    broker_order_id?: string | null;
    broker_position_id?: string | null;
  },
): Promise<number | null> {
  const { data } = await admin.from("ai_trade_actions").insert(row).select("id").single();
  return (data as { id?: number } | null)?.id ?? null;
}

function verdictPayload(v: TradeVerdict) {
  return {
    broker_outcome: v.outcome,
    broker_message: v.message,
    broker_order_id: v.orderId,
    broker_position_id: v.positionId,
    note:
      v.outcome === "unknown"
        ? "The broker did not confirm either way. P-Trades will NOT resend. Check the account before trying again."
        : undefined,
  };
}

// ---------------- place ----------------

export async function runPlaceOrder(userId: string, clientId: string, raw: unknown, deps: TradingDeps = defaultTradingDeps) {
  const parsed = placeOrderInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid input");
  const p = parsed.data;
  const canonical = p.instrument.trim().toUpperCase();
  if (p.order_type === "limit" && !p.entry_price) return fail("A limit order needs entry_price.");

  const ctx = await authorize(deps, userId, clientId, p.account_id, "place");
  if ("content" in ctx) return ctx;
  const { admin, account, grant, isLive } = ctx;
  const metaId = account.metaapi_account_id as string;
  const region = account.region as string;
  const accountType = isLive ? "live" : "demo";
  const reject = async (reason: string) => {
    await logAction(admin, { grant_id: grant.id, user_id: userId, account_id: account.id, account_type: accountType, action: "place", request: p, outcome: "refused", detail: reason });
    return fail(reason);
  };

  if (typeof account.magic !== "number" || account.magic <= 0) return reject("This account has no P-Trades order tag yet.");

  // Cohort rule (allow / reduce / block) for this instrument and direction.
  const { data: cohort } = await admin
    .from("auto_cohort_policies")
    .select("policy, risk_share_percent")
    .eq("user_id", userId)
    .eq("instrument", canonical)
    .eq("direction", p.direction)
    .maybeSingle();
  const c = cohort as { policy?: string; risk_share_percent?: number } | null;
  if (c?.policy === "block") return reject(`You blocked ${canonical} ${p.direction} trades.`);
  const cohortShare = c?.policy === "reduce" ? Math.min(Math.max(Number(c.risk_share_percent ?? 100), 0), 100) / 100 : 1;

  // High-impact news blackout (±30 min), unless the account policy allows news trading.
  const { data: pol } = await admin
    .from("connected_account_risk_policies")
    .select("news_trading_allowed")
    .eq("account_id", account.id)
    .maybeSingle();
  if ((pol as { news_trading_allowed?: boolean | null } | null)?.news_trading_allowed !== true) {
    const now = deps.now();
    const { data: news } = await admin
      .from("economic_events")
      .select("event_family, scheduled_at")
      .eq("importance", "high")
      .contains("affected_instruments", [canonical])
      .gte("scheduled_at", new Date(now - 30 * 60_000).toISOString())
      .lte("scheduled_at", new Date(now + 30 * 60_000).toISOString())
      .limit(1);
    if ((news ?? []).length > 0) return reject(`High-impact news for ${canonical} within 30 minutes.`);
  }

  // Duplicate guard: same account/instrument/direction accepted in the last 60 s.
  const { data: recent } = await admin
    .from("ai_trade_actions")
    .select("id")
    .eq("user_id", userId)
    .eq("account_id", account.id)
    .eq("action", "place")
    .in("outcome", ["accepted", "unknown", "pending"])
    .eq("request->>instrument", p.instrument)
    .eq("request->>direction", p.direction)
    .gte("created_at", new Date(deps.now() - 60_000).toISOString())
    .limit(1);
  if ((recent ?? []).length > 0) return reject("The same trade was just sent. Refusing a duplicate.");

  // Entry: live price for market, given price for limit. Check protection sides.
  const brokerSymbol = await deps.resolveBrokerSymbol(admin, account.id, canonical, account.broker_server);
  if (!brokerSymbol) return reject(`${canonical} is not mapped to a broker symbol on this account.`);
  let entry = p.entry_price ?? 0;
  if (p.order_type === "market") {
    const q = await deps.quote(metaId, region, brokerSymbol);
    if (!q) return reject("The broker returned no live price.");
    entry = p.direction === "long" ? q.ask : q.bid;
  }
  const prot = protectionOk(p.direction, entry, p.stop_loss, p.take_profit);
  if (!prot.ok) return reject(prot.reason);

  // The nine Runtime Validation gates, sized on the real stop distance.
  const report = await deps.runValidation(admin, {
    accountId: account.id,
    symbol: canonical,
    direction: p.direction,
    stopDistance: Math.abs(entry - p.stop_loss),
  });
  if (!report.passed || !report.lots || !report.risk_percent) {
    const failed = report.gates.find((g) => g.status === "FAIL");
    return reject(`Safety check failed at ${failed?.gate ?? "unknown"}: ${failed?.reason ?? "no size"}`);
  }
  const spec = await deps.spec(admin, account.id, canonical);
  const factor = (Math.min(report.risk_percent, grant.max_risk_percent) / report.risk_percent) * cohortShare;
  const lots = scaleLots(report.lots, factor, spec?.lotStep ?? 0.01, spec?.minLot ?? 0.01);
  if (!lots) return reject("The allowed risk is too small for the broker's minimum size.");

  // Consume one order slot atomically, then send once.
  const { data: consumed } = await admin.rpc("consume_ai_grant_order", { _grant_id: grant.id });
  if (consumed !== true) return reject("The session's order limit is used up or the session ended.");

  const actionId = await logAction(admin, { grant_id: grant.id, user_id: userId, account_id: account.id, account_type: accountType, action: "place", request: { ...p, lots, entry_reference: entry }, outcome: "pending" });
  const { buildClientId } = await import("@/lib/metaapi/client-id");
  const clientRef = buildClientId({ strategyId: "PTAI", positionRef: grant.id.replace(/-/g, "").slice(0, 8), orderRef: String(actionId ?? deps.now()) });
  const base = { symbol: brokerSymbol, volume: lots, stopLoss: p.stop_loss, takeProfit: p.take_profit, clientId: clientRef, magic: account.magic };
  const verdict =
    p.order_type === "market"
      ? await deps.submitMarket(metaId, region, { ...base, actionType: p.direction === "long" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL" } as never)
      : await deps.submitPending(metaId, region, {
          ...base,
          actionType: p.direction === "long" ? "ORDER_TYPE_BUY_LIMIT" : "ORDER_TYPE_SELL_LIMIT",
          openPrice: entry,
          expirationTime: new Date(deps.now() + (p.expiry_minutes ?? 240) * 60_000).toISOString(),
        } as never);
  if (actionId !== null) {
    await admin
      .from("ai_trade_actions")
      .update({ outcome: verdict.outcome, detail: verdict.message, broker_order_id: verdict.orderId, broker_position_id: verdict.positionId })
      .eq("id", actionId);
  }
  return envelope(
    {
      account: account.label,
      account_type: accountType,
      instrument: canonical,
      broker_symbol: brokerSymbol,
      direction: p.direction,
      order_type: p.order_type,
      lots,
      lots_source: "P-Trades broker-derived sizing (never the AI)",
      risk_percent_used: Number((Math.min(report.risk_percent, grant.max_risk_percent) * cohortShare).toFixed(4)),
      ...verdictPayload(verdict),
    },
    verdict.outcome === "rejected",
  );
}

// ---------------- modify / close / order modify ----------------

const isBuy = (type: string | null | undefined) => /BUY/i.test(type ?? "");

export async function runModifyPosition(userId: string, clientId: string, raw: unknown, deps: TradingDeps = defaultTradingDeps) {
  const parsed = modifyPositionInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid input");
  const p = parsed.data;
  const ctx = await authorize(deps, userId, clientId, p.account_id, "modify");
  if ("content" in ctx) return ctx;
  const metaId = ctx.account.metaapi_account_id as string;
  const region = ctx.account.region as string;
  const pos = (await deps.positions(metaId, region)).find((x) => String(x.id) === p.position_id);
  if (!pos) return fail("That position is not open on this account.");
  const px = Number(pos.currentPrice);
  const long = isBuy(pos.type);
  if (Number.isFinite(px) && px > 0) {
    if (long ? p.stop_loss >= px : p.stop_loss <= px) return fail("The new stop loss is on the wrong side of the current price.");
    if (p.take_profit !== undefined && (long ? p.take_profit <= px : p.take_profit >= px))
      return fail("The new take profit is on the wrong side of the current price.");
  }
  const v = await deps.modifyPosition(metaId, region, p.position_id, p.stop_loss, p.take_profit);
  await logAction(ctx.admin, { grant_id: ctx.grant.id, user_id: userId, account_id: ctx.account.id, account_type: ctx.isLive ? "live" : "demo", action: "modify_position", request: p, outcome: v.outcome, detail: v.message, broker_position_id: p.position_id });
  return envelope({ position_id: p.position_id, ...verdictPayload(v) }, v.outcome === "rejected");
}

export async function runClosePosition(userId: string, clientId: string, raw: unknown, deps: TradingDeps = defaultTradingDeps) {
  const parsed = closePositionInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid input");
  const p = parsed.data;
  const ctx = await authorize(deps, userId, clientId, p.account_id, "close");
  if ("content" in ctx) return ctx;
  const metaId = ctx.account.metaapi_account_id as string;
  const region = ctx.account.region as string;
  const pos = (await deps.positions(metaId, region)).find((x) => String(x.id) === p.position_id);
  if (!pos) return fail("That position is not open on this account.");
  const full = p.volume === undefined || p.volume >= Number(pos.volume ?? 0);
  const v = full
    ? await deps.closeFull(metaId, region, p.position_id)
    : await deps.closePartial(metaId, region, p.position_id, p.volume as number);
  await logAction(ctx.admin, { grant_id: ctx.grant.id, user_id: userId, account_id: ctx.account.id, account_type: ctx.isLive ? "live" : "demo", action: full ? "close_position" : "partial_close", request: p, outcome: v.outcome, detail: v.message, broker_position_id: p.position_id });
  return envelope({ position_id: p.position_id, closed: full ? "all" : p.volume, ...verdictPayload(v) }, v.outcome === "rejected");
}

export async function runModifyRestingOrder(userId: string, clientId: string, raw: unknown, deps: TradingDeps = defaultTradingDeps) {
  const parsed = modifyOrderInput.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "invalid input");
  const p = parsed.data;
  const ctx = await authorize(deps, userId, clientId, p.account_id, "modify");
  if ("content" in ctx) return ctx;
  const metaId = ctx.account.metaapi_account_id as string;
  const region = ctx.account.region as string;
  const ord = (await deps.orders(metaId, region)).find((x) => String(x.id) === p.order_id);
  if (!ord) return fail("That waiting order is not on this account.");
  const prot = protectionOk(isBuy(ord.type) ? "long" : "short", p.entry_price, p.stop_loss, p.take_profit);
  if (!prot.ok) return fail(prot.reason);
  const v = await deps.modifyOrder(metaId, region, p.order_id, p.entry_price, p.stop_loss, p.take_profit);
  await logAction(ctx.admin, { grant_id: ctx.grant.id, user_id: userId, account_id: ctx.account.id, account_type: ctx.isLive ? "live" : "demo", action: "modify_order", request: p, outcome: v.outcome, detail: v.message, broker_order_id: p.order_id });
  return envelope({ order_id: p.order_id, size_changed: false, ...verdictPayload(v) }, v.outcome === "rejected");
}

// ---------------- arm ----------------

export async function runArmAccount(userId: string, clientId: string, raw: unknown, deps: TradingDeps = defaultTradingDeps) {
  const parsed = armInput.safeParse(raw);
  if (!parsed.success)
    return fail("mode must be observe, demo_auto or live_confirm. Live auto can only be armed by the user in P-Trades.");
  const p = parsed.data;
  const ctx = await authorize(deps, userId, clientId, p.account_id, "arm");
  if ("content" in ctx) return ctx;
  if (p.mode === "live_confirm") {
    const report = await deps.runValidation(ctx.admin, { accountId: p.account_id, symbol: "EURUSD", direction: "long", stopDistance: 0.002 });
    if (!report.passed) {
      const failed = report.gates.find((g) => g.status === "FAIL");
      return fail(`Runtime Validation failed at ${failed?.gate}: ${failed?.reason}. Fix it before arming live.`);
    }
  }
  try {
    const r = await deps.arm(userId, p.account_id, p.mode);
    await logAction(ctx.admin, { grant_id: ctx.grant.id, user_id: userId, account_id: p.account_id, account_type: ctx.isLive ? "live" : "demo", action: "arm", request: p, outcome: "accepted" });
    return envelope({ account: ctx.account.label, mode: r.mode });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Arming failed";
    await logAction(ctx.admin, { grant_id: ctx.grant.id, user_id: userId, account_id: p.account_id, account_type: ctx.isLive ? "live" : "demo", action: "arm", request: p, outcome: "refused", detail: msg });
    return fail(msg);
  }
}

// ---------------- session status ----------------

export async function runGetTradingAccess(db: Db, userId: string, clientId: string) {
  const { data, error } = await db
    .from("ai_trading_grants")
    .select("id, client_id, client_label, account_ids, actions, include_live, max_orders, orders_used, max_risk_percent, expires_at, revoked_at, created_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) return fail(error.message);
  const rows = (data ?? []) as Grant[];
  const mine = rows.find((g) => g.client_id === clientId) ?? null;
  return envelope({
    active_session: mine,
    notes: {
      none: mine ? undefined : "No active trading session for this AI app. Call request_trading_access.",
      limits: "Size always comes from P-Trades' broker-derived sizing. Every order re-runs the nine safety checks.",
    },
  });
}
