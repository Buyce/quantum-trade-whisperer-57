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
  trading_grant: "Start an AI trading session",
};

export function ProposalCard({ id }: { id: string }) {
  const [p, setP] = useState<ProposalView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () =>
    getProposal({ data: { id } })
      .then((v) => setP(v as ProposalView | null))
      .catch((e: Error) => setErr(e.message));
  useEffect(() => {
    void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [grant, setGrant] = useState<GrantEdit | null>(null);
  const decide = async (decision: "approve" | "decline") => {
    setBusy(true);
    setErr(null);
    try {
      await decideProposal({ data: { id, decision, ...(grant && decision === "approve" ? { grant: grant as unknown as Record<string, unknown> } : {}) } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
    await load();
    setBusy(false);
  };

  if (p === undefined) return <p className="text-xs text-muted-foreground">Loading proposal…</p>;
  if (p === null) return <p className="text-xs text-destructive">Proposal not found.</p>;
  const result = p.result?.message;
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
          {p.kind === "trading_grant" && p.payload && (
            <GrantForm payload={p.payload} onChange={setGrant} />
          )}
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

interface GrantEdit {
  actions: string[];
  minutes: number;
  max_orders: number;
  max_risk_percent: number;
  include_live: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  place: "Place trades",
  modify: "Change stop / target",
  close: "Close trades",
  arm: "Arm accounts",
};

/** Lets the user narrow what the AI asked for before approving. */
function GrantForm({ payload, onChange }: { payload: Record<string, string | number | boolean | string[] | null>; onChange: (g: GrantEdit) => void }) {
  const asked = (payload["actions"] as string[] | undefined) ?? [];
  const [g, setG] = useState<GrantEdit>({
    actions: asked,
    minutes: Number(payload["minutes"] ?? 60),
    max_orders: Number(payload["max_orders"] ?? 5),
    max_risk_percent: Number(payload["max_risk_percent"] ?? 0.5),
    include_live: payload["include_live"] === true,
  });
  useEffect(() => onChange(g), [g]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<GrantEdit>) => setG((prev) => ({ ...prev, ...patch }));
  return (
    <div className="space-y-2 rounded border border-border bg-background p-2 text-xs">
      <div className="flex flex-wrap gap-3">
        {asked.map((a) => (
          <label key={a} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={g.actions.includes(a)}
              onChange={(e) =>
                set({ actions: e.target.checked ? [...g.actions, a] : g.actions.filter((x) => x !== a) })
              }
            />
            {ACTION_LABEL[a] ?? a}
          </label>
        ))}
      </div>
      <label className="flex items-center justify-between gap-2">
        How long
        <select className="rounded border border-border bg-background px-1" value={g.minutes} onChange={(e) => set({ minutes: Number(e.target.value) })}>
          <option value={15}>15 min</option>
          <option value={60}>1 hour</option>
          <option value={240}>4 hours</option>
          <option value={480}>8 hours</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">
        Max new orders
        <input type="number" min={1} max={50} className="w-16 rounded border border-border bg-background px-1" value={g.max_orders} onChange={(e) => set({ max_orders: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />
      </label>
      <label className="flex items-center justify-between gap-2">
        Max risk per order (% of equity)
        <input type="number" step={0.05} min={0.05} max={5} className="w-16 rounded border border-border bg-background px-1" value={g.max_risk_percent} onChange={(e) => set({ max_risk_percent: Math.max(0.05, Math.min(5, Number(e.target.value) || 0.05)) })} />
      </label>
      {payload["include_live"] === true && (
        <label className="flex items-start gap-1 text-destructive">
          <input type="checkbox" checked={g.include_live} onChange={(e) => set({ include_live: e.target.checked })} />
          Include LIVE (real-money) accounts. The AI can place and close real trades without asking again until the session ends.
        </label>
      )}
      <p className="text-muted-foreground">
        P-Trades still sets the size, runs every safety check, and never goes above your account risk policy. You can revoke on the Accounts page, and the emergency stop ends it at once.
      </p>
    </div>
  );
}
