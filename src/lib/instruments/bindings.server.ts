/**
 * Operator symbol BINDINGS.
 *
 * Discovery refuses to choose when a broker exposes several tickers for the same
 * canonical instrument (`NAS100` -> `USTEC` / `USTECH100M`) and it refuses to
 * invent one when no ticker matches its accepted patterns. That refusal is
 * correct — a guess can route an order to the wrong contract — but it leaves the
 * instrument permanently stuck.
 *
 * A binding is the ONLY way that deadlock is broken: a named human records which
 * single broker ticker a canonical instrument means, with the candidate list that
 * was on the table at the time. It is an operator DECISION, recorded as evidence;
 * it is never derived, never inferred and never written by a cron.
 *
 * A binding proves the NAME only. Specification, candles, quote, conversion and
 * spread evidence must still be earned under that name before anything is
 * published — see `readiness.server.ts` and `promotion.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SymbolBinding {
  canonical: string;
  providerSymbol: string;
  boundBy: string;
  reason: string | null;
  candidates: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

type Db = Pick<SupabaseClient, "from">;

interface BindingRow {
  canonical: string;
  provider_symbol: string;
  bound_by: string;
  reason: string | null;
  candidates: string[] | null;
  created_at: string | null;
  updated_at: string | null;
}

function mapRow(row: BindingRow): SymbolBinding {
  return {
    canonical: row.canonical,
    providerSymbol: row.provider_symbol,
    boundBy: row.bound_by,
    reason: row.reason ?? null,
    candidates: Array.isArray(row.candidates) ? row.candidates : [],
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

const COLUMNS = "canonical, provider_symbol, bound_by, reason, candidates, created_at, updated_at";

/**
 * One instrument's binding, or null when none was ever recorded.
 *
 * A read failure returns null, which means "no binding": the canonical name is
 * then used, exactly as before bindings existed. Failing open to a *guessed*
 * ticker is the outcome this whole module exists to prevent.
 */
export async function readBinding(db: Db, canonical: string): Promise<SymbolBinding | null> {
  const { data, error } = await db
    .from("instrument_symbol_bindings")
    .select(COLUMNS)
    .eq("canonical", canonical.trim().toUpperCase())
    .maybeSingle();
  if (error || !data) return null;
  return mapRow(data as unknown as BindingRow);
}

/** Every binding, newest first. Used by the admin panel and diagnostics. */
export async function listBindings(db: Db): Promise<SymbolBinding[]> {
  const { data, error } = await db
    .from("instrument_symbol_bindings")
    .select(COLUMNS)
    .order("canonical", { ascending: true });
  if (error || !data) return [];
  return (data as unknown as BindingRow[]).map(mapRow);
}

/**
 * The provider symbol a *specification* read must use for this instrument: the
 * bound ticker when one exists, otherwise the canonical name.
 */
export async function specFetchSymbol(db: Db, canonical: string): Promise<string> {
  const binding = await readBinding(db, canonical);
  return binding?.providerSymbol ?? canonical;
}

export async function writeBinding(
  db: Db,
  args: {
    canonical: string;
    providerSymbol: string;
    boundBy: string;
    reason?: string | null;
    candidates?: string[];
    evidence?: Record<string, unknown>;
  },
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await db.from("instrument_symbol_bindings").upsert(
    {
      canonical: args.canonical.trim().toUpperCase(),
      provider_symbol: args.providerSymbol.trim(),
      bound_by: args.boundBy,
      reason: args.reason ?? null,
      candidates: args.candidates ?? [],
      evidence: (args.evidence ?? {}) as never,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "canonical" },
  );
  return { ok: !error, error: error?.message ?? null };
}

export async function deleteBinding(
  db: Db,
  canonical: string,
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await db
    .from("instrument_symbol_bindings")
    .delete()
    .eq("canonical", canonical.trim().toUpperCase());
  return { ok: !error, error: error?.message ?? null };
}
