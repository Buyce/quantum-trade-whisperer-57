/**
 * Live-account control center: one glance per account — connection, mode,
 * broker permission, current exposure, emergency-stop state and any
 * reconciliation mismatches waiting for review. Tapping a row jumps to the
 * detailed card below. Stacked cards on phones, a grid on wider screens.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, OctagonX, Plug, Unplug } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ConnectedAccountView } from "@/lib/accounts/types";
import {
  acknowledgeDiscrepancy,
  getControlCenterExtras,
  type DiscrepancyView,
} from "@/lib/control-center.functions";

const MODE: Record<ConnectedAccountView["mode"], string> = {
  observe: "Observe",
  demo_auto: "Demo auto",
  live_confirm: "Live · confirm each",
  live_auto: "Live auto",
};

function permission(a: ConnectedAccountView): { label: string; ok: boolean | null } {
  if (a.broker.investorMode === true || a.readOnly) return { label: "Read-only", ok: false };
  if (a.broker.tradeAllowed === true) return { label: "Trading allowed", ok: true };
  if (a.broker.tradeAllowed === false) return { label: "Trading blocked", ok: false };
  return { label: "Permission unknown", ok: null };
}

export function ControlCenter({ accounts }: { accounts: ConnectedAccountView[] }) {
  const fetchExtras = useServerFn(getControlCenterExtras);
  const ack = useServerFn(acknowledgeDiscrepancy);
  const qc = useQueryClient();
  const extras = useQuery({
    queryKey: ["control-center"],
    queryFn: () => fetchExtras(),
    refetchInterval: 60_000,
  });
  const ackMutation = useMutation({
    mutationFn: (id: string) => ack({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["control-center"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not acknowledge"),
  });

  const discrepancies = extras.data?.discrepancies ?? [];
  const byAccount = new Map<string, DiscrepancyView[]>();
  for (const d of discrepancies) byAccount.set(d.accountId, [...(byAccount.get(d.accountId) ?? []), d]);

  return (
    <section className="mb-4" aria-label="Account control center">
      <h2 className="mb-2 text-sm font-semibold">Control center</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {accounts.map((a) => {
          const perm = permission(a);
          const exp = extras.data?.exposure[a.id];
          const flagged = byAccount.get(a.id)?.length ?? 0;
          const connected = !a.disconnectedAt && a.ready;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() =>
                document.getElementById(`account-${a.id}`)?.scrollIntoView({ behavior: "smooth" })
              }
              className="rounded-sm border border-border bg-surface p-3 text-left transition-colors hover:bg-accent/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{a.label}</span>
                <Badge variant="outline" className="uppercase">
                  {a.broker.accountType}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <Badge variant={connected ? "secondary" : "destructive"} className="gap-1">
                  {connected ? <Plug className="size-3" /> : <Unplug className="size-3" />}
                  {connected ? "Connected" : a.disconnectedAt ? "Disconnected" : "Not verified"}
                </Badge>
                <Badge variant={a.mode === "observe" ? "outline" : "default"}>{MODE[a.mode]}</Badge>
                <Badge variant={perm.ok === false ? "destructive" : "outline"}>{perm.label}</Badge>
                {a.emergencyStopAt ? (
                  <Badge variant="destructive" className="gap-1">
                    <OctagonX className="size-3" /> Stopped
                  </Badge>
                ) : null}
                {flagged > 0 ? (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="size-3" /> {flagged} to review
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {exp
                  ? `${exp.openPositions} open · ${exp.restingOrders} waiting`
                  : extras.isLoading
                    ? "Checking exposure…"
                    : "No P-Trades positions open"}
                {a.maxAccountOpenPositions !== null ? ` · limit ${a.maxAccountOpenPositions}` : ""}
              </p>
            </button>
          );
        })}
      </div>

      {extras.error ? (
        <p className="mt-2 text-xs text-destructive">Could not load exposure and review items.</p>
      ) : null}

      {discrepancies.length > 0 ? (
        <div className="mt-3 rounded-sm border border-destructive/40 bg-surface p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4 text-destructive" /> Needs review
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your broker and P-Trades disagree on these items. Nothing was changed automatically —
            check them in your trading platform.
          </p>
          <ul className="mt-2 space-y-2">
            {discrepancies.map((d) => (
              <li key={d.id} className="flex flex-col gap-2 border-t border-border pt-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 text-xs">
                  <Badge variant={d.severity === "critical" ? "destructive" : "secondary"} className="mr-1">
                    {d.severity}
                  </Badge>
                  {d.summary}
                  <span className="block text-muted-foreground">
                    Last seen {new Date(d.lastSeenAt).toUTCString()}
                  </span>
                </div>
                {d.status === "open" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={ackMutation.isPending}
                    onClick={() => ackMutation.mutate(d.id)}
                  >
                    Acknowledge
                  </Button>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-3" /> Acknowledged
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
