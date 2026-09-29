/**
 * Pure rules for AI trading sessions ("approve once per session").
 * No I/O — shared by the server executors and the tests.
 */
import { z } from "zod";

export const GRANT_ACTIONS = ["place", "modify", "close", "arm"] as const;
export type GrantAction = (typeof GRANT_ACTIONS)[number];
export const GRANT_MINUTES = [15, 60, 240, 480] as const;

export const grantRequestInput = z.object({
  account_ids: z.array(z.string().uuid()).min(1).max(20),
  actions: z.array(z.enum(GRANT_ACTIONS)).min(1),
  minutes: z
    .number()
    .int()
    .refine(
      (m) => (GRANT_MINUTES as readonly number[]).includes(m),
      "minutes must be 15, 60, 240 or 480",
    )
    .default(60),
  max_orders: z.number().int().min(1).max(50).default(5),
  max_risk_percent: z.number().gt(0).max(5).default(0.5),
  include_live: z.boolean().default(false),
  reason: z.string().max(300).optional(),
});
export type GrantRequest = z.infer<typeof grantRequestInput>;

export interface Grant {
  id: string;
  user_id: string;
  client_id: string;
  account_ids: string[];
  actions: string[];
  include_live: boolean;
  max_orders: number;
  orders_used: number;
  max_risk_percent: number;
  expires_at: string;
  revoked_at: string | null;
}

export type GrantCheck = { ok: true } | { ok: false; reason: string };

export function grantAllows(
  grant: Grant | null,
  q: { action: GrantAction; accountId: string; isLive: boolean; clientId: string; now: number },
): GrantCheck {
  if (!grant)
    return {
      ok: false,
      reason:
        "No active trading session. Call request_trading_access and ask the user to approve it.",
    };
  if (grant.client_id !== q.clientId)
    return { ok: false, reason: "This session belongs to a different AI app." };
  if (grant.revoked_at) return { ok: false, reason: "The user revoked this trading session." };
  if (Date.parse(grant.expires_at) <= q.now)
    return { ok: false, reason: "The trading session has expired." };
  if (!grant.actions.includes(q.action))
    return { ok: false, reason: `The session does not allow '${q.action}'.` };
  if (!grant.account_ids.includes(q.accountId))
    return { ok: false, reason: "That account is not part of this session." };
  if (q.isLive && !grant.include_live)
    return { ok: false, reason: "Live (real-money) accounts are not included in this session." };
  if (q.action === "place" && grant.orders_used >= grant.max_orders)
    return { ok: false, reason: "The session's order limit is used up." };
  return { ok: true };
}

/** Stop below / target above entry for longs, the reverse for shorts. */
export function protectionOk(
  direction: "long" | "short",
  entry: number,
  stop: number,
  target: number,
): GrantCheck {
  if (![entry, stop, target].every((n) => Number.isFinite(n) && n > 0))
    return { ok: false, reason: "Prices must be positive numbers." };
  if (direction === "long" && !(stop < entry && target > entry))
    return {
      ok: false,
      reason: "For a long trade the stop loss must be below entry and the take profit above it.",
    };
  if (direction === "short" && !(stop > entry && target < entry))
    return {
      ok: false,
      reason: "For a short trade the stop loss must be above entry and the take profit below it.",
    };
  return { ok: true };
}

/** Scale a broker-derived size down (never up) and round DOWN to the broker step. */
export function scaleLots(lots: number, factor: number, step: number, min: number): number | null {
  const f = Math.min(Math.max(factor, 0), 1);
  const s = step > 0 ? step : 0.01;
  const raw = lots * f;
  const stepped = Math.floor(raw / s + 1e-9) * s;
  const rounded = Number(stepped.toFixed(8));
  return rounded >= min && rounded > 0 ? rounded : null;
}

export const placeOrderInput = z.object({
  account_id: z.string().uuid(),
  instrument: z.string().min(3).max(20),
  direction: z.enum(["long", "short"]),
  order_type: z.enum(["market", "limit"]),
  entry_price: z.number().positive().optional(),
  stop_loss: z.number().positive(),
  take_profit: z.number().positive(),
  expiry_minutes: z.number().int().min(5).max(1440).optional(),
});

export const modifyPositionInput = z.object({
  account_id: z.string().uuid(),
  position_id: z.string().min(1).max(64),
  stop_loss: z.number().positive(),
  take_profit: z.number().positive().optional(),
});

export const closePositionInput = z.object({
  account_id: z.string().uuid(),
  position_id: z.string().min(1).max(64),
  volume: z.number().positive().optional(),
});

export const modifyOrderInput = z.object({
  account_id: z.string().uuid(),
  order_id: z.string().min(1).max(64),
  entry_price: z.number().positive(),
  stop_loss: z.number().positive(),
  take_profit: z.number().positive(),
});

export const armInput = z.object({
  account_id: z.string().uuid(),
  mode: z.enum(["observe", "demo_auto", "live_confirm"]),
});
