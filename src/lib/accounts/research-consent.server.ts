/**
 * Explicit, versioned consent for FUTURE pooled broker-evidence research.
 *
 * This is a service-role write because connected-account RLS is intentionally
 * read-only for customers. Ownership is still required in the update predicate;
 * an account id supplied by another user can never be changed.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { RESEARCH_CONSENT_VERSION } from "@/lib/research/consent";

export interface ResearchConsentResult {
  enabled: boolean;
  version: number;
  updatedAt: string;
}

export async function setResearchConsent(
  userId: string,
  accountId: string,
  enabled: boolean,
  now = new Date(),
): Promise<ResearchConsentResult> {
  const updatedAt = now.toISOString();
  const { data, error } = await supabaseAdmin
    .from("connected_trading_accounts")
    .update({
      research_consent: enabled,
      research_consent_version: RESEARCH_CONSENT_VERSION,
      research_consent_at: updatedAt,
    })
    .eq("id", accountId)
    .eq("user_id", userId)
    .is("disconnected_at", null)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Connected account not found.");

  return { enabled, version: RESEARCH_CONSENT_VERSION, updatedAt };
}
