/**
 * Prompt 14 final completion — the owner's account-wide BROKER exposure boundary.
 *
 * This is the only writer of `max_account_open_positions`. It is deliberately
 * narrow: a whole number of simultaneous broker positions/orders, or `null` for
 * "no boundary configured". The boundary is enforced at submission time in
 * `@/lib/execution/direct.server.ts` against the broker's own open positions and
 * pending orders, and fails closed when the broker cannot be read — so saving a
 * boundary here never becomes a claim about broker state.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TABLE = "connected_trading_accounts";

/** Highest boundary a trader may configure; above this it stops being a boundary. */
export const MAX_CONFIGURABLE_OPEN_POSITIONS = 50;

export async function setAccountExposureBoundary(
  userId: string,
  accountId: string,
  maxOpenPositions: number | null,
): Promise<{ maxAccountOpenPositions: number | null }> {
  let value: number | null = null;
  if (maxOpenPositions !== null) {
    if (
      !Number.isInteger(maxOpenPositions) ||
      maxOpenPositions < 1 ||
      maxOpenPositions > MAX_CONFIGURABLE_OPEN_POSITIONS
    ) {
      throw new Error(
        `An exposure boundary must be a whole number between 1 and ${MAX_CONFIGURABLE_OPEN_POSITIONS}, or left off entirely.`,
      );
    }
    value = maxOpenPositions;
  }

  // Ownership is re-checked in the write itself, so a supplied account id can
  // never reach another trader's row even though the caller is already verified.
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ max_account_open_positions: value } as never)
    .eq("id", accountId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That broker account was not found on your profile.");

  return { maxAccountOpenPositions: value };
}
