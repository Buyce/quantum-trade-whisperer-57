/**
 * Per-candidate lineage: capture -> enrolment -> replay outcome -> broker.
 *
 * A rejected candidate was never sent to a broker, so its broker columns are
 * empty and labelled "never sent — no broker order". Replay-derived R is
 * labelled as such and never mixed with broker money.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCandidateLineage } from "@/lib/candidates.functions";
import type { CandidateLineageRow } from "@/lib/learning/candidates";
import { utcMinute } from "@/lib/format-utc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE = 25;

function utc(ts: string | null): string {
  if (!ts) return "—";
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace("T", " ").slice(0, 16) : "—";
}

function replayOutcome(row: CandidateLineageRow): string {
  if (row.research_window_status === "outside_replay_window") {
    return "outside replay window — history no longer available";
  }
  if (!row.shadow_status) return "not enrolled yet";
  if (row.shadow_outcome) {
    const r = row.shadow_realized_r;
    return `${row.shadow_outcome}${r === null ? "" : ` · ${r.toFixed(2)}R (replay)`}`;
  }
  return `${row.shadow_status} — still replaying`;
}

function brokerCell(row: CandidateLineageRow): string {
  if (!row.published_signal_id) return "never sent — no broker order";
  if (!row.enqueue_decision) return "published, no auto-order attempt";
  if (!row.broker_state) return `auto-order ${row.enqueue_decision}${row.enqueue_reason ? `: ${row.enqueue_reason}` : ""}`;
  const money =
    row.broker_net_profit === null
      ? ""
      : ` · ${row.broker_net_profit.toFixed(2)} ${row.broker_currency ?? ""}`.trimEnd();
  const r = row.broker_r_vs_plan === null ? "" : ` · ${row.broker_r_vs_plan.toFixed(2)}R vs plan`;
  return `broker ${row.broker_state}${money}${r}`;
}

export function CandidateLineagePanel() {
  const [offset, setOffset] = useState(0);
  const fetchLineage = useServerFn(getCandidateLineage);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "candidate-lineage", offset],
    queryFn: () => fetchLineage({ data: { limit: PAGE_SIZE, offset } }),
    staleTime: 30_000,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Candidate lineage</CardTitle>
        <p className="text-sm text-muted-foreground">
          Newest enrolments first. Replay R comes from real candles; broker figures only exist for
          candidates that were actually published and auto-ordered.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive">
            Could not load lineage: {error instanceof Error ? error.message : "unknown error"}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No candidates recorded for this page.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 text-left">Instrument</th>
                    <th className="py-2 pr-3 text-left">Grade</th>
                    <th className="py-2 pr-3 text-left">Detected (UTC)</th>
                    <th className="py-2 pr-3 text-left">Enrolled (UTC)</th>
                    <th className="py-2 pr-3 text-left">Replay outcome</th>
                    <th className="py-2 text-left">Broker</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.candidate_id} className="border-b border-border/50">
                      <td className="py-2 pr-3">
                        {row.instrument}
                        <span className="ml-1 text-xs text-muted-foreground">{row.direction ?? ""}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={row.published_signal_id ? "default" : "outline"}>
                          {row.grade ?? row.cf_grade ?? "—"}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{utc(row.detected_at)}</td>
                      <td className="py-2 pr-3 tabular-nums">{utc(row.enrolled_at)}</td>
                      <td className="py-2 pr-3">{replayOutcome(row)}</td>
                      <td className="py-2 text-muted-foreground">{brokerCell(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {offset + 1}–{offset + rows.length} of {total}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={offset + rows.length >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
