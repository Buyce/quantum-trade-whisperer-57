/**
 * Owner-only learning evidence and gate-change actions.
 *
 * Every read and write goes through a `SECURITY DEFINER` RPC that re-checks
 * `is_admin()`; the owner check here is the second layer, not the only one.
 * Approving a proposal is the ONLY path that can change an effective gate
 * threshold, and it writes an audited override row — this module contains no
 * other threshold write path.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertOwner, ownerEmail } from "@/lib/candidates.functions";
import {
  EMPTY_LEARNING_EVIDENCE,
  type LearningEvidence,
} from "@/lib/learning/evidence";

type Rpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Serializable acknowledgement returned by the proposal/decision RPCs. */
interface GateActionResult {
  ok: boolean;
  id?: string;
  verdict?: string;
  status?: string;
  current_value?: number | null;
}

export const getLearningEvidence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LearningEvidence> => {
    assertOwner(context.claims as Record<string, unknown>);
    const rpc = context.supabase.rpc.bind(context.supabase) as unknown as Rpc;
    const { data, error } = await rpc("get_admin_learning_evidence");
    if (error) throw new Error(error.message);
    return (data as LearningEvidence) ?? EMPTY_LEARNING_EVIDENCE;
  });

export const proposeGateChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        gate: z.enum(["risk_ceiling", "headroom", "reachable_r"]),
        proposedValue: z.number().positive().max(100),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(data),
  )
  .handler(async ({ context, data }): Promise<GateActionResult> => {
    const claims = context.claims as Record<string, unknown>;
    assertOwner(claims);
    const rpc = context.supabase.rpc.bind(context.supabase) as unknown as Rpc;
    const { data: result, error } = await rpc("propose_gate_change", {
      _gate: data.gate,
      _proposed_value: data.proposedValue,
      _reason: data.reason,
      _actor: ownerEmail(claims),
    });
    if (error) throw new Error(error.message);
    return (result ?? { ok: false }) as GateActionResult;
  });

export const decideGateChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["approved", "rejected", "reverted"]),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(data),
  )
  .handler(async ({ context, data }): Promise<GateActionResult> => {
    const claims = context.claims as Record<string, unknown>;
    assertOwner(claims);
    const rpc = context.supabase.rpc.bind(context.supabase) as unknown as Rpc;
    const { data: result, error } = await rpc("decide_gate_change", {
      _id: data.id,
      _decision: data.decision,
      _reason: data.reason,
      _actor: ownerEmail(claims),
    });
    if (error) throw new Error(error.message);
    return (result ?? { ok: false }) as GateActionResult;
  });
