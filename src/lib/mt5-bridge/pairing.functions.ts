/**
 * Owner-controlled pairing for the direct MT5 bridge.
 *
 * The raw bridge token is returned exactly once. Only its SHA-256 digest is
 * persisted. Pairing grants read-only snapshot ingestion, never trading.
 */
import { createHash, randomBytes, randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Db = SupabaseClient<never, never, never>;
const MAX_ACTIVE_BRIDGES = 4;

const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

export interface Mt5BridgeConnectionView {
  id: string;
  bridgeId: string;
  intent: "demo" | "live";
  status: "awaiting_first_snapshot" | "healthy" | "degraded" | "refused" | "revoked";
  statusReason: string | null;
  lastSeenAt: string | null;
  lastObservedAt: string | null;
  brokerLoginMasked: string | null;
  brokerServer: string | null;
  brokerName: string | null;
  brokerMode: string | null;
  createdAt: string;
}

export const listMt5BridgeConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Mt5BridgeConnectionView[]> => {
    const db = context.supabase as unknown as Db;
    const { data, error } = await db
      .from("mt5_bridge_connections" as never)
      .select(
        "id, bridge_id, intent, status, status_reason, last_seen_at, last_observed_at, broker_login_masked, broker_server, broker_name, broker_mode, created_at",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      bridgeId: String(row.bridge_id),
      intent: row.intent as "demo" | "live",
      status: row.status as Mt5BridgeConnectionView["status"],
      statusReason: typeof row.status_reason === "string" ? row.status_reason : null,
      lastSeenAt: typeof row.last_seen_at === "string" ? row.last_seen_at : null,
      lastObservedAt: typeof row.last_observed_at === "string" ? row.last_observed_at : null,
      brokerLoginMasked:
        typeof row.broker_login_masked === "string" ? row.broker_login_masked : null,
      brokerServer: typeof row.broker_server === "string" ? row.broker_server : null,
      brokerName: typeof row.broker_name === "string" ? row.broker_name : null,
      brokerMode: typeof row.broker_mode === "string" ? row.broker_mode : null,
      createdAt: String(row.created_at),
    }));
  });

export const createMt5BridgePairing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ intent: z.enum(["demo", "live"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as Db;

    const { count, error: countError } = await db
      .from("mt5_bridge_connections" as never)
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .is("revoked_at", null);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= MAX_ACTIVE_BRIDGES) {
      throw new Error("Revoke an unused direct MT5 bridge before creating another.");
    }

    const bridgeId = `mt5b_${randomUUID().replaceAll("-", "")}`;
    const token = `ptb_${randomBytes(32).toString("base64url")}`;
    const { data: inserted, error } = await db
      .from("mt5_bridge_connections" as never)
      .insert({
        user_id: context.userId,
        bridge_id: bridgeId,
        intent: data.intent,
        token_hash: hashToken(token),
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return {
      id: String((inserted as unknown as { id: string }).id),
      bridgeId,
      token,
      ingestPath: "/api/public/mt5-bridge/ingest",
      intent: data.intent,
      warning:
        "This token is shown once. It can upload read-only MT5 snapshots but cannot arm or place trades.",
    };
  });

export const revokeMt5BridgePairing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as Db;
    const now = new Date().toISOString();
    const { data: row, error } = await db
      .from("mt5_bridge_connections" as never)
      .update({
        revoked_at: now,
        status: "revoked",
        status_reason: "Revoked by account owner.",
        token_hash: `revoked:${randomUUID()}`,
        snapshot: null,
      } as never)
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Bridge pairing not found or already revoked.");
    return { ok: true };
  });
