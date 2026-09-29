/**
 * Public ingress for the local/VPS direct-MT5 bridge.
 *
 * Authentication is an account-scoped opaque bearer token. Only its SHA-256
 * digest exists in the database. The SQL ingest function atomically enforces
 * bridge id, protocol, broker mode, sequence monotonicity and freshness.
 *
 * This endpoint stores broker observations only. It has no execution path.
 */
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";

import {
  MT5_BRIDGE_PROTOCOL_VERSION,
  validateMt5BridgeSnapshot,
  type Mt5BridgeSnapshot,
} from "@/lib/mt5-bridge/protocol";

type Db = SupabaseClient<never, never, never>;
const MAX_BODY_BYTES = 512 * 1024;

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

function bearer(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return /^ptb_[A-Za-z0-9_-]{40,80}$/.test(token) ? token : null;
}

export const Route = createFileRoute("/api/public/mt5-bridge/ingest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = bearer(request);
        const bridgeId = request.headers.get("x-p-trades-bridge-id")?.trim();
        if (!token || !bridgeId) {
          return json({ ok: false, error: "Bridge authentication required." }, 401);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as unknown as Db;
        const { data, error } = await db
          .from("mt5_bridge_connections" as never)
          .select("last_sequence, status")
          .eq("token_hash", hashToken(token))
          .eq("bridge_id", bridgeId)
          .is("revoked_at", null)
          .maybeSingle();
        if (error || !data) {
          return json({ ok: false, error: "Bridge authentication failed." }, 401);
        }
        const row = data as unknown as { last_sequence: number; status: string };
        return json({
          ok: true,
          protocolVersion: MT5_BRIDGE_PROTOCOL_VERSION,
          nextSequence: Number(row.last_sequence) + 1,
          status: row.status,
        });
      },
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return json({ ok: false, error: "Bridge authentication required." }, 401);

        const declared = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
          return json({ ok: false, error: "Bridge snapshot is too large." }, 413);
        }

        const raw = await request.text();
        if (raw.length === 0 || raw.length > MAX_BODY_BYTES) {
          return json({ ok: false, error: "Bridge snapshot is empty or too large." }, 400);
        }

        let snapshot: Mt5BridgeSnapshot;
        try {
          snapshot = JSON.parse(raw) as Mt5BridgeSnapshot;
        } catch {
          return json({ ok: false, error: "Bridge snapshot must be valid JSON." }, 400);
        }

        const structural = validateMt5BridgeSnapshot(snapshot);
        if (structural.length > 0) {
          return json(
            { ok: false, error: "Bridge snapshot failed validation.", fields: structural },
            400,
          );
        }
        if (snapshot.protocolVersion !== MT5_BRIDGE_PROTOCOL_VERSION) {
          return json({ ok: false, error: "Unsupported bridge protocol version." }, 409);
        }
        if (snapshot.positions.length > 500 || snapshot.orders.length > 500) {
          return json({ ok: false, error: "Bridge snapshot exceeds position/order limits." }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as unknown as Db;
        const { data, error } = await db.rpc(
          "ingest_mt5_bridge_snapshot" as never,
          {
            _token_hash: hashToken(token),
            _bridge_id: snapshot.bridgeId,
            _sequence: snapshot.sequence,
            _observed_at: snapshot.observedAt,
            _snapshot: snapshot,
          } as never,
        );

        if (error) {
          const message = error.message.toLowerCase();
          const authFailure =
            message.includes("authentication") || message.includes("revoked");
          const stale =
            message.includes("sequence") ||
            message.includes("freshness") ||
            message.includes("timestamp");
          return json(
            {
              ok: false,
              error: authFailure
                ? "Bridge authentication failed."
                : stale
                  ? "Bridge snapshot was stale or replayed."
                  : "Bridge snapshot was refused.",
            },
            authFailure ? 401 : stale ? 409 : 400,
          );
        }

        const first = Array.isArray(data)
          ? (data[0] as { connection_status?: string } | undefined)
          : undefined;
        if (first?.connection_status === "refused") {
          return json(
            {
              ok: false,
              status: "refused",
              error: "Broker-confirmed account mode does not match the pairing intent.",
            },
            409,
          );
        }

        return json({
          ok: true,
          status: first?.connection_status ?? "accepted",
          protocolVersion: MT5_BRIDGE_PROTOCOL_VERSION,
        });
      },
    },
  },
});
