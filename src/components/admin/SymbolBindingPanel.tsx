/**
 * Broker symbol bindings (owner only).
 *
 * Discovery refuses to choose when the broker lists several tickers for the same
 * canonical instrument, and refuses to invent one when it lists none. That is the
 * correct behaviour — a guessed ticker can size and route an order against the
 * wrong contract — but it also means those instruments can never earn evidence
 * until a human names the ticker. This panel is that decision surface.
 *
 * Binding proves the NAME only. The instrument still has to pass specification,
 * candle, quote, conversion and spread checks, and still has to satisfy the
 * promotion gate, before anything is published or executed. Nothing here changes
 * a lifecycle stage.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  bindInstrumentSymbol,
  getAdminSymbolBindings,
  recommissionInstrument,
  unbindInstrumentSymbol,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelShell, timeAgo } from "@/components/admin/AdminPanels";

type RecheckResult = Awaited<ReturnType<typeof recommissionInstrument>>;

export function SymbolBindingPanel() {
  const load = useServerFn(getAdminSymbolBindings);
  const bind = useServerFn(bindInstrumentSymbol);
  const unbind = useServerFn(unbindInstrumentSymbol);
  const recheck = useServerFn(recommissionInstrument);
  const queryClient = useQueryClient();

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [recheckResult, setRecheckResult] = useState<RecheckResult | null>(null);

  const query = useQuery({
    queryKey: ["admin-symbol-bindings"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-symbol-bindings"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-commissioning"] });
  };

  const bindMutation = useMutation({
    mutationFn: (vars: { canonical: string; providerSymbol: string }) => bind({ data: vars }),
    onSuccess: (result, vars) => {
      setMessage(
        result.ok
          ? `${vars.canonical} is now bound to ${vars.providerSymbol}. Run a recheck to fetch its specification under that name.`
          : (result.error ?? "The binding was not recorded."),
      );
      invalidate();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const unbindMutation = useMutation({
    mutationFn: (canonical: string) => unbind({ data: { canonical } }),
    onSuccess: (result, canonical) => {
      setMessage(
        result.ok
          ? `${canonical} is unbound; the scanner is back to its canonical name.`
          : (result.error ?? "The binding was not removed."),
      );
      invalidate();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const recheckMutation = useMutation({
    mutationFn: (canonical: string) => recheck({ data: { canonical } }),
    onSuccess: (result) => {
      setRecheckResult(result);
      setMessage(null);
      invalidate();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  if (query.isLoading) return <Skeleton className="h-40" />;

  if (query.isError || !query.data) {
    return (
      <PanelShell title="Broker symbol bindings">
        <p className="text-[11px] text-warning">
          Binding records could not be read, so nothing is claimed here about which broker symbol
          each instrument uses.
        </p>
      </PanelShell>
    );
  }

  const rows = query.data;

  return (
    <PanelShell
      title="Broker symbol bindings"
      right={
        <span className="text-[11px] text-muted-foreground">
          {rows.filter((r) => r.binding).length} bound of {rows.length}
        </span>
      }
    >
      <p className="mb-3 text-[11px] text-muted-foreground">
        A binding names the one broker symbol an instrument means. It proves the name only —
        specification, candle, quote, conversion and spread evidence must still be earned under that
        name, and the promotion gate still applies. Binding never changes a lifecycle stage.
      </p>

      {message ? <p className="mb-3 text-[11px] text-warning">{message}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-3">Instrument</th>
              <th className="py-1 pr-3">Stage</th>
              <th className="py-1 pr-3">Bound symbol</th>
              <th className="py-1 pr-3">Broker candidates</th>
              <th className="py-1 pr-3">Spec fetched as</th>
              <th className="py-1 pr-3">Bind / recheck</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const busy =
                bindMutation.isPending ||
                unbindMutation.isPending ||
                recheckMutation.isPending;
              return (
                <tr key={row.canonical} className="border-t border-border/40 align-top">
                  <td className="py-1.5 pr-3 font-mono">{row.canonical}</td>
                  <td className="py-1.5 pr-3">{row.stage ?? "—"}</td>
                  <td className="py-1.5 pr-3 font-mono">
                    {row.binding ? (
                      <span>
                        {row.binding.providerSymbol}
                        <span className="ml-1 font-sans text-muted-foreground">
                          by {row.binding.boundBy} · {timeAgo(row.binding.updatedAt)}
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    {row.discovery ? (
                      <span>
                        <span className="text-muted-foreground">{row.discovery.outcome ?? "—"}</span>
                        {row.discovery.candidates.length ? (
                          <span className="ml-1 font-mono">
                            {row.discovery.candidates.join(", ")}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      "no discovery evidence"
                    )}
                  </td>
                  <td className="py-1.5 pr-3 font-mono">
                    {row.specProviderSymbol ?? "—"}
                    {row.specFetchedAt ? (
                      <span className="ml-1 font-sans text-muted-foreground">
                        {timeAgo(row.specFetchedAt)}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <Input
                        value={drafts[row.canonical] ?? ""}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [row.canonical]: e.target.value }))
                        }
                        placeholder="exact broker symbol"
                        className="h-7 w-40 text-[11px]"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-[11px]"
                        disabled={busy || !(drafts[row.canonical] ?? "").trim()}
                        onClick={() =>
                          bindMutation.mutate({
                            canonical: row.canonical,
                            providerSymbol: (drafts[row.canonical] ?? "").trim(),
                          })
                        }
                      >
                        Bind
                      </Button>
                      {row.binding ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11px]"
                          disabled={busy}
                          onClick={() => unbindMutation.mutate(row.canonical)}
                        >
                          Unbind
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        disabled={busy}
                        onClick={() => recheckMutation.mutate(row.canonical)}
                      >
                        Recheck
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {recheckResult ? (
        <div className="mt-3 rounded border border-border/60 p-2 text-[11px]">
          <p className="font-mono">{recheckResult.canonical} recheck</p>
          <p className="text-muted-foreground">
            discovery {recheckResult.discoveryOutcome ?? "—"} · specification{" "}
            {recheckResult.specAction ?? "—"} · readiness snapshot{" "}
            {recheckResult.snapshotWritten ? "written" : "not written"}
          </p>
          <p className="mt-1">{recheckResult.detail}</p>
          {recheckResult.blockers.length ? (
            <p className="mt-1 text-warning">blockers: {recheckResult.blockers.join(", ")}</p>
          ) : null}
          {recheckResult.error ? (
            <p className="mt-1 text-warning">{recheckResult.error}</p>
          ) : null}
          <p className="mt-1 text-muted-foreground">
            A recheck records evidence only. It does not change the lifecycle stage, publish a
            signal or place an order.
          </p>
        </div>
      ) : null}
    </PanelShell>
  );
}
