/**
 * Approve / Decline card for an AI proposal. Used inside chat messages and on
 * the /approvals/$id page that outside AI apps (ChatGPT, Claude, Gemini) link to.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { decideProposal, getProposal, type ProposalView } from "@/lib/ai-tools/proposals.functions";

const KIND_LABEL: Record<string, string> = {
  cancel_order: "Cancel a waiting order",
  risk_policy: "Save a risk policy",
  cohort_policy: "Change an automatic-trading rule",
};

export function ProposalCard({ id }: { id: string }) {
  const [p, setP] = useState<ProposalView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () =>
    getProposal({ data: { id } })
      .then(setP)
      .catch((e: Error) => setErr(e.message));
  useEffect(() => {
    void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (decision: "approve" | "decline") => {
    setBusy(true);
    setErr(null);
    try {
      await decideProposal({ data: { id, decision } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
    await load();
    setBusy(false);
  };

  if (p === undefined) return <p className="text-xs text-muted-foreground">Loading proposal…</p>;
  if (p === null) return <p className="text-xs text-destructive">Proposal not found.</p>;
  const result = (p.result as { message?: string } | null)?.message;
  const pending = p.status === "pending" && !p.expired;

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {KIND_LABEL[p.kind] ?? p.kind} · needs your approval
      </p>
      <p className="text-sm font-medium">{p.summary}</p>
      {pending ? (
        <>
          <p className="text-xs text-muted-foreground">
            Nothing has changed yet. Expires {new Date(p.expiresAt).toLocaleTimeString()}.
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void decide("approve")}>
              Approve
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide("decline")}>
              Decline
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs">
          {p.expired ? "Expired — nothing changed." : `${p.status}${result ? ` — ${result}` : ""}`}
        </p>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
