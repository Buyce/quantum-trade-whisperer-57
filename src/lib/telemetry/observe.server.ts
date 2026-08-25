/**
 * Provider-usage observations.
 *
 * Answers one operational question honestly: how much MetaApi did P-Trades
 * actually use, and how did the provider answer? Without this, "we are within
 * budget" is a belief rather than a measurement.
 *
 * Three deliberate properties:
 *   - It records ONE row per provider call attempt, including failures, because a
 *     refused call still consumes quota and still explains an outage.
 *   - It stores no request bodies, tokens, account logins or symbols beyond a short
 *     label, so an observation ledger can never become a credential leak.
 *   - It can never propagate an error. Observability that breaks the thing it
 *     observes is worse than no observability.
 */
export type ApiOutcome = "ok" | "error" | "timeout" | "throttled" | "unauthorized";

export interface ApiObservation {
  /** Coarse provider surface, e.g. "market-data", "provisioning", "metastats". */
  surface: string;
  outcome: ApiOutcome;
  httpStatus?: number | null;
  latencyMs?: number | null;
  /** Optional short label. Never a token, body or account identifier. */
  detail?: string | null;
  accountId?: string | null;
  /** Provider-side cost weight of the call; 1 unless a surface is known dearer. */
  costUnits?: number;
}

export async function recordApiObservation(observation: ApiObservation): Promise<void> {
  // Under test the observation path is inert. Unit tests assert the EXACT outbound
  // provider traffic of the request layer, and a telemetry insert would add its own
  // network call to that count — an observer that changes what it observes.
  if (process.env["VITEST"]) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("metaapi_api_observations").insert({
      surface: observation.surface,
      account_id: observation.accountId ?? null,
      outcome: observation.outcome,
      http_status: observation.httpStatus ?? null,
      latency_ms: observation.latencyMs ?? null,
      cost_units: observation.costUnits ?? 1,
      detail: observation.detail ? observation.detail.slice(0, 200) : null,
    });
  } catch {
    // Intentionally silent: see the module header.
  }
}

/** Map an HTTP status onto the outcome vocabulary. */
export function outcomeForStatus(status: number | null | undefined): ApiOutcome {
  if (status === 429) return "throttled";
  if (status === 401 || status === 403) return "unauthorized";
  if (typeof status === "number" && status >= 200 && status < 300) return "ok";
  return "error";
}
