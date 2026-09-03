/**
 * Filter Lift — what the scanner learned from the setups it REJECTED.
 *
 * Each gate has two arms replayed under the same frozen research ladder: the
 * published arm (what passed) and the rejected arm (what the gate blocked). The
 * panel reports the comparison and, when it is statistically readable, says
 * which direction the evidence points. It never changes a live threshold: any
 * change stays a manual decision by the owner.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFilterLift } from "@/lib/candidates.functions";
import { VERDICT_LABELS, type FilterLiftGate } from "@/lib/learning/filter-lift";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { utcMinute } from "@/lib/format-utc";

function verdictVariant(gate: FilterLiftGate): "default" | "secondary" | "outline" | "destructive" {
  if (gate.verdict === "loosening_supported") return "destructive";
  if (gate.verdict === "gate_supported") return "default";
  if (gate.verdict === "no_difference") return "secondary";
  return "outline";
}

function fmtR(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}R`;
}

function interval(low: number | null, high: number | null): string {
  if (low === null || high === null) return "interval not available";
  return `95% CI ${low.toFixed(2)} … ${high.toFixed(2)}`;
}

export function FilterLiftPanel() {
  const fetchLift = useServerFn(getFilterLift);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "filter-lift"],
    queryFn: () => fetchLift(),
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Filter Lift — learning from rejected setups</CardTitle>
        <p className="text-sm text-muted-foreground">
          Replayed research outcomes only. Measurement, not automation: no live threshold changes
          from this panel.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive">
            Could not load filter lift: {error instanceof Error ? error.message : "unknown error"}
          </p>
        ) : !data || data.gates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No gate statistics recorded yet. Rows appear after enrolled candidates mature and the
            hourly recompute runs.
          </p>
        ) : (
          <div className="space-y-3">
            {data.gates.map((gate) => (
              <div key={gate.gate} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{gate.gate}</span>
                  <Badge variant={verdictVariant(gate)}>{VERDICT_LABELS[gate.verdict]}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{gate.detail}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="text-xs text-muted-foreground">
                    <div className="text-foreground">Published arm {fmtR(gate.pass?.meanR ?? null)}</div>
                    <div>
                      n={gate.pass?.nUsed ?? 0} · {interval(gate.pass?.low ?? null, gate.pass?.high ?? null)}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div className="text-foreground">Rejected arm {fmtR(gate.fail?.meanR ?? null)}</div>
                    <div>
                      n={gate.fail?.nUsed ?? 0} · {interval(gate.fail?.low ?? null, gate.fail?.high ?? null)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Recomputed hourly after research resolution · as of{" "}
              {utcMinute(data.generated_at)} UTC
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
