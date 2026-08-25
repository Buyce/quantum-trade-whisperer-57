/**
 * Commissioning readiness endpoint (operator-triggered, cron-authorised).
 *
 * The daily readiness cron only proves instruments the sampler is ALREADY
 * authorised to read. Commissioning is the opposite direction: it must prove a
 * still-`disabled` instrument BEFORE it may be authorised. So this endpoint takes
 * an explicit, bounded symbol list, runs the full evidence pass per symbol and
 * returns the decision plus every blocker.
 *
 * It writes evidence only: alias discovery, a specification row, a readiness
 * snapshot. It never transitions a stage, never enables a flag, never publishes,
 * alerts or submits an order.
 */
import { createFileRoute } from "@tanstack/react-router";

import { authorizeCronRequest, unauthorizedResponse } from "@/lib/cron-auth";

/** Bounded per call so one operator request cannot drain the provider budget. */
const MAX_SYMBOLS_PER_CALL = 3;

export const Route = createFileRoute("/api/public/cron/commission-readiness")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCronRequest(request)) return unauthorizedResponse();

        let body: unknown = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const requested = Array.isArray((body as { symbols?: unknown }).symbols)
          ? (body as { symbols: unknown[] }).symbols
              .filter((s): s is string => typeof s === "string")
              .map((s) => s.trim().toUpperCase())
          : [];
        const withInventory = (body as { discover?: unknown }).discover !== false;

        if (requested.length === 0) {
          return Response.json(
            { ok: false, error: "symbols is required and must be a non-empty array" },
            { status: 400 },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { isRegistrySymbol } = await import("@/lib/instruments/registry");
        const { runCommissioningPass } = await import("@/lib/instruments/commissioning.server");

        const symbols = requested.filter(isRegistrySymbol).slice(0, MAX_SYMBOLS_PER_CALL);
        const rejected = requested.filter((s) => !isRegistrySymbol(s));

        let inventory: string[] | null = null;
        if (withInventory) {
          try {
            const { fetchInventory } = await import("@/lib/instruments/discovery.server");
            inventory = await fetchInventory();
          } catch (err) {
            console.error("[cron/commission-readiness] inventory", err);
            inventory = null;
          }
        }

        const results = [];
        for (const symbol of symbols) {
          results.push(await runCommissioningPass(supabaseAdmin, symbol, inventory));
        }

        return Response.json({
          ok: true,
          inventorySize: inventory?.length ?? 0,
          rejected,
          results,
        });
      },
    },
  },
});
