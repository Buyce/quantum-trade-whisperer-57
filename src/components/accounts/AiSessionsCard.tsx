/**
 * AI trading sessions the user approved, with their recent AI actions and a
 * Revoke button. Hidden when there is nothing to show.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  listMyTradingGrants,
  revokeTradingGrant,
  type GrantView,
} from "@/lib/ai-tools/proposals.functions";

type Data = Awaited<ReturnType<typeof listMyTradingGrants>>;

export function AiSessionsCard() {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    listMyTradingGrants()
      .then(setD)
      .catch(() => setD(null));
  useEffect(() => {
    void load();
  }, []);
  if (!d || (d.grants.length === 0 && d.actions.length === 0)) return null;

  const revoke = async (id?: string) => {
    setBusy(true);
    await revokeTradingGrant({ data: id ? { id } : {} }).catch(() => undefined);
    await load();
    setBusy(false);
  };

  return (
    <section className="mb-4 space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">AI trading sessions</h2>
        {d.grants.length > 0 && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void revoke()}>
            Revoke all
          </Button>
        )}
      </div>
      {d.grants.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No active session. AI apps cannot trade right now.
        </p>
      ) : (
        d.grants.map((g: GrantView) => (
          <div
            key={g.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2 text-xs"
          >
            <div>
              <p className="font-medium">
                {g.client_label ?? "AI app"} · {g.include_live ? "LIVE + demo" : "demo only"}
              </p>
              <p className="text-muted-foreground">
                {g.actions.join(", ")} · {g.orders_used}/{g.max_orders} orders · ≤
                {g.max_risk_percent}% risk · ends {new Date(g.expires_at).toLocaleTimeString()}
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void revoke(g.id)}>
              Revoke now
            </Button>
          </div>
        ))
      )}
      {d.actions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Recent AI actions</p>
          {d.actions.map((a) => (
            <p key={a.id} className="text-xs">
              <span className="font-mono">{new Date(a.created_at).toLocaleString()}</span> ·{" "}
              {a.account_type?.toUpperCase()} · {a.action} {a.instrument} ·{" "}
              <span className="font-medium">{a.outcome}</span>
              {a.detail ? ` — ${a.detail}` : ""}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
