import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { validateQuantity } from "@/lib/delivery/execution";
import { classifyMetaApiFailure } from "@/lib/metaapi/errors";
import { estimateMargin, type MarginResponseInspection } from "@/lib/metaapi/margin.server";
import type { MetaApiRequestObservation } from "@/lib/metaapi/request.server";
import { supabaseForUser } from "../supabase";

export interface DiagnoseBrokerMarginArgs {
  account_id: string;
  logical_symbol: string;
  action_type: "ORDER_TYPE_BUY" | "ORDER_TYPE_SELL";
  volume: number;
  open_price: number;
}

function transientProviderKind(kind: string): boolean {
  return ["timeout", "unreachable", "rate_limited", "processing", "server"].includes(kind);
}

/**
 * Authenticated, non-trading margin probe. Its only MetaApi call is the
 * calculate-margin endpoint. It imports no trade function and stores no
 * response, credential or provider account id.
 */
export async function runDiagnoseBrokerMargin(supabase: unknown, args: DiagnoseBrokerMarginArgs) {
  const db = supabase as ReturnType<typeof supabaseForUser>;
  const { data: account, error: accountError } = await db
    .from("connected_trading_accounts")
    .select(
      "id, metaapi_account_id, region, phase, connection_status, provisioning_state, trade_allowed, investor_mode, broker_observed_at, disconnected_at",
    )
    .eq("id", args.account_id)
    .maybeSingle();
  if (accountError || !account) {
    return {
      content: [{ type: "text" as const, text: accountError?.message ?? "Account not found" }],
      isError: true,
    };
  }
  const row = account as Record<string, unknown>;
  const metaapiAccountId =
    typeof row["metaapi_account_id"] === "string" ? row["metaapi_account_id"] : "";
  const region = typeof row["region"] === "string" ? row["region"] : "";
  if (!metaapiAccountId || !region || row["disconnected_at"]) {
    return {
      content: [{ type: "text" as const, text: "This account has no active MetaApi connection." }],
      isError: true,
    };
  }

  const logicalSymbol = args.logical_symbol.trim().toUpperCase();
  const { data: mapping, error: mappingError } = await db
    .from("connected_account_symbols")
    .select("broker_symbol, mapping_kind")
    .eq("account_id", args.account_id)
    .eq("canonical_symbol", logicalSymbol)
    .maybeSingle();
  const mapped = mapping as { broker_symbol?: string | null; mapping_kind?: string | null } | null;
  if (mappingError || !mapped?.broker_symbol || mapped.mapping_kind === "ambiguous") {
    return {
      content: [
        {
          type: "text" as const,
          text: mappingError?.message ?? `No unambiguous mapping for ${logicalSymbol}.`,
        },
      ],
      isError: true,
    };
  }

  const { data: spec, error: specError } = await db
    .from("connected_account_specs")
    .select("volume_min, volume_max, volume_step, volume_limit")
    .eq("account_id", args.account_id)
    .eq("broker_symbol", mapped.broker_symbol)
    .maybeSingle();
  if (specError || !spec) {
    return {
      content: [
        { type: "text" as const, text: specError?.message ?? "Broker specification unavailable." },
      ],
      isError: true,
    };
  }
  const numberOrNull = (value: unknown) => {
    const parsed = Number(value);
    return value !== null && value !== "" && Number.isFinite(parsed) ? parsed : null;
  };
  const specRow = spec as Record<string, unknown>;
  const volumeCheck = validateQuantity(args.volume, {
    minLot: numberOrNull(specRow["volume_min"]),
    maxLot: numberOrNull(specRow["volume_max"]),
    lotStep: numberOrNull(specRow["volume_step"]),
    volumeCap: numberOrNull(specRow["volume_limit"]),
  });
  if (!volumeCheck.ok) {
    return {
      content: [
        { type: "text" as const, text: `Invalid diagnostic volume: ${volumeCheck.detail}` },
      ],
      isError: true,
    };
  }
  if (!(Number.isFinite(args.open_price) && args.open_price > 0)) {
    return {
      content: [{ type: "text" as const, text: "Open price must be finite and positive." }],
      isError: true,
    };
  }

  // Re-read the last broker-synchronized state immediately before the request.
  // This stays inside the user's RLS scope and avoids every MetaApi endpoint
  // except calculate-margin.
  const { data: state, error: stateError } = await db
    .from("connected_trading_accounts")
    .select(
      "phase, connection_status, provisioning_state, trade_allowed, investor_mode, broker_observed_at",
    )
    .eq("id", args.account_id)
    .maybeSingle();
  if (stateError || !state) {
    return {
      content: [
        {
          type: "text" as const,
          text: stateError?.message ?? "Account readiness state unavailable.",
        },
      ],
      isError: true,
    };
  }
  const stateRow = state as Record<string, unknown>;

  const readiness = {
    snapshot_source: "stored_broker_state_immediately_before_request",
    phase: stateRow["phase"] ?? null,
    connection_status: stateRow["connection_status"] ?? null,
    provisioning_state: stateRow["provisioning_state"] ?? null,
    trade_allowed: stateRow["trade_allowed"] ?? null,
    investor_mode: stateRow["investor_mode"] ?? null,
    broker_observed_at: stateRow["broker_observed_at"] ?? null,
  };

  const observations: MetaApiRequestObservation[] = [];
  const inspection: { value: MarginResponseInspection | null } = { value: null };
  const startedAt = Date.now();
  let result:
    | { ok: true; margin: number }
    | { ok: false; failure: ReturnType<typeof classifyMetaApiFailure> };
  try {
    const margin = await estimateMargin(
      metaapiAccountId,
      region,
      {
        symbol: mapped.broker_symbol,
        type: args.action_type,
        volume: args.volume,
        openPrice: args.open_price,
      },
      {
        onRequestObservation: (value) => observations.push(value),
        onResponseInspection: (value) => {
          inspection.value = value;
        },
      },
    );
    result = { ok: true, margin };
  } catch (err) {
    result = { ok: false, failure: classifyMetaApiFailure(err) };
  }

  const last = observations.at(-1) ?? null;
  const payload = {
    non_trading_diagnostic: true,
    endpoint: "POST /users/current/accounts/{accountId}/calculate-margin",
    trade_endpoint_called: false,
    request: {
      logical_symbol: logicalSymbol,
      broker_symbol: mapped.broker_symbol,
      action_type: args.action_type,
      normalized_volume: args.volume,
      open_price: args.open_price,
      price_source: "supplied_historical_case",
      region,
    },
    readiness,
    http_status: last?.httpStatus ?? (result.ok ? 200 : result.failure.status),
    elapsed_ms: Date.now() - startedAt,
    timeout: observations.some((item) => item.timedOut),
    response_content_type: last?.contentType ?? null,
    response_shape: last?.responseShape ?? "none",
    margin_exists: inspection.value?.marginExists ?? false,
    raw_margin_type: inspection.value?.rawMarginType ?? "unavailable",
    margin_finite: inspection.value?.marginFinite ?? false,
    margin: result.ok ? result.margin : null,
    failure: result.ok ? null : result.failure,
    provider_semantics: result.ok
      ? "success"
      : transientProviderKind(result.failure.kind)
        ? "transient"
        : "deterministic_or_configuration",
    attempts: observations,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
    ...(!result.ok ? { isError: true } : {}),
  };
}

export default defineTool({
  name: "diagnose_broker_margin",
  title: "Diagnose broker margin calculation",
  description:
    "Run one authenticated, non-trading MetaApi calculate-margin diagnostic for one of the signed-in user's connected accounts. Resolves the broker symbol server-side, validates the supplied volume against the stored broker specification, snapshots stored broker readiness immediately before the request, calls no other MetaApi endpoint, never calls /trade, never submits an order and never returns credentials or the MetaApi account id.",
  inputSchema: {
    account_id: z.string().uuid().describe("Connected account id from list_my_accounts."),
    logical_symbol: z.string().min(1).max(20),
    action_type: z.enum(["ORDER_TYPE_BUY", "ORDER_TYPE_SELL"]),
    volume: z.number().positive(),
    open_price: z.number().positive(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    return runDiagnoseBrokerMargin(supabaseForUser(ctx), input);
  },
});
