/**
 * Admin → Intelligence: market context evidence.
 *
 * Shows what intermarket context is actually held (dollar index, US yields,
 * gold, oil, VIX), the weekly futures positioning behind each currency, every
 * fetch attempt including failures, and how replay outcomes compare when a
 * setup ran with the dollar versus against it.
 *
 * Context is measured, never enforced: nothing here refuses, resizes or reorders
 * an order. An empty table means we hold no reading — it never means "calm" or
 * "neutral".
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { PanelShell } from "@/components/admin/AdminPanels";
import { getAdminMarketContext } from "@/lib/admin.functions";

const SERIES_LABELS: Record<string, string> = {
  dollar_index: "US dollar index",
  us_2y_yield: "US 2-year yield",
  us_10y_yield: "US 10-year yield",
  gold: "Gold (USD)",
  wti_oil: "WTI crude (USD)",
  vix: "VIX",
};

function formatDate(value: string | null): string {
  return value ? value.slice(0, 10) : "—";
}

export function MarketContextPanel() {
  const fetchContext = useServerFn(getAdminMarketContext);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "market-context"],
    queryFn: () => fetchContext({}),
    refetchInterval: 300_000,
  });

  return (
    <PanelShell title="Market context — measured, never enforced">
      <p className="mb-4 text-xs text-muted-foreground">
        Recorded for measurement only: context never holds, resizes or reorders an order.
      </p>
      {isLoading && <p className="text-sm text-muted-foreground">Loading market context…</p>}
      {error && (
        <p className="text-sm text-destructive">
          Could not read market context: {(error as Error).message}
        </p>
      )}

      {data && (
        <div className="space-y-6">
          <section>
            <h3 className="text-sm font-medium">Latest readings held</h3>
            {data.latest.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                No readings are stored. That means we hold no context — not that markets are calm.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Series</th>
                      <th className="py-1 pr-3">Value</th>
                      <th className="py-1 pr-3">Published for</th>
                      <th className="py-1 pr-3">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.latest.map((row) => (
                      <tr key={row.series_key} className="border-t border-border/50">
                        <td className="py-1 pr-3">
                          {SERIES_LABELS[row.series_key] ?? row.series_key}
                        </td>
                        <td className="py-1 pr-3 tabular-nums">{Number(row.value).toFixed(3)}</td>
                        <td className="py-1 pr-3">{formatDate(row.observation_date)}</td>
                        <td className="py-1 pr-3 uppercase">{row.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-medium">
              Futures positioning (weekly, published with a lag)
            </h3>
            {data.positioning.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">No positioning report is stored.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Currency</th>
                      <th className="py-1 pr-3">Net contracts</th>
                      <th className="py-1 pr-3">Net %</th>
                      <th className="py-1 pr-3">Report date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.positioning.map((row) => (
                      <tr
                        key={`${row.currency}-${row.report_date}`}
                        className="border-t border-border/50"
                      >
                        <td className="py-1 pr-3">{row.currency}</td>
                        <td className="py-1 pr-3 tabular-nums">
                          {row.net_contracts === null
                            ? "—"
                            : Number(row.net_contracts).toLocaleString()}
                        </td>
                        <td className="py-1 pr-3 tabular-nums">
                          {row.net_percent === null
                            ? "—"
                            : `${Number(row.net_percent).toFixed(1)}%`}
                        </td>
                        <td className="py-1 pr-3">{formatDate(row.report_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-medium">With the dollar vs against it (replay outcomes)</h3>
            {data.alignment.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                No resolved setups carry a context label yet, so there is nothing to compare.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Instrument</th>
                      <th className="py-1 pr-3">Context</th>
                      <th className="py-1 pr-3">Samples</th>
                      <th className="py-1 pr-3">Mean R</th>
                      <th className="py-1 pr-3">Win %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.alignment.map((row) => (
                      <tr
                        key={`${row.instrument}-${row.alignment}`}
                        className="border-t border-border/50"
                      >
                        <td className="py-1 pr-3">{row.instrument}</td>
                        <td className="py-1 pr-3">{row.alignment}</td>
                        <td className="py-1 pr-3 tabular-nums">{row.n}</td>
                        <td className="py-1 pr-3 tabular-nums">
                          {row.mean_r === null ? "—" : Number(row.mean_r).toFixed(3)}
                        </td>
                        <td className="py-1 pr-3 tabular-nums">
                          {row.win_pct === null ? "—" : `${Number(row.win_pct).toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Small sample counts prove nothing. These splits stay descriptive until a cohort has
              enough resolved setups to pass the usual validation floors.
            </p>
          </section>

          <section>
            <h3 className="text-sm font-medium">Fetch attempts</h3>
            {data.runs.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">No fetch has been attempted yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Job</th>
                      <th className="py-1 pr-3">Source</th>
                      <th className="py-1 pr-3">Outcome</th>
                      <th className="py-1 pr-3">Values written</th>
                      <th className="py-1 pr-3">Started</th>
                      <th className="py-1 pr-3">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.runs.map((row, index) => (
                      <tr
                        key={`${row.job}-${row.started_at}-${index}`}
                        className="border-t border-border/50"
                      >
                        <td className="py-1 pr-3">{row.job}</td>
                        <td className="py-1 pr-3 uppercase">{row.source}</td>
                        <td className="py-1 pr-3">{row.status}</td>
                        <td className="py-1 pr-3 tabular-nums">{row.values_written ?? 0}</td>
                        <td className="py-1 pr-3">
                          {new Date(row.started_at).toISOString().slice(0, 16)}
                        </td>
                        <td className="py-1 pr-3 text-muted-foreground">{row.error_note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </PanelShell>
  );
}
