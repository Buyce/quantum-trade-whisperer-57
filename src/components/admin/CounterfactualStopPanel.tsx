/**
 * Counterfactual Stop Harness — what a tighter stop would have returned.
 *
 * Re-runs already-resolved replay setups under a tighter initial stop and shows
 * the honest spread. The CONSERVATIVE column is the only one that may inform a
 * decision: it pays every unprovable case as a full loss. The optimistic column
 * is an upper bound and is labelled as such. This panel changes nothing live.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCounterfactualStops } from "@/lib/counterfactual.functions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { utcMinute } from "@/lib/format-utc";

function fmtR(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(3)}R`;
}

function interval(low: number | null, high: number | null): string {
  if (low === null || high === null) return "interval not available";
  return `95% CI ${low.toFixed(3)} … ${high.toFixed(3)}`;
}

export function CounterfactualStopPanel() {
  const fetchStops = useServerFn(getCounterfactualStops);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "counterfactual-stops"],
    queryFn: () => fetchStops(),
    staleTime: 300_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Counterfactual stop harness</CardTitle>
        <p className="text-sm text-muted-foreground">
          Replayed history only. Every unprovable case is counted as a full loss, so the
          conservative figure is a floor, not a forecast. Nothing here changes live behaviour.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive">
            Could not load the harness: {error instanceof Error ? error.message : "unknown error"}
          </p>
        ) : !data || data.factors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No resolved replay outcomes to measure yet.
          </p>
        ) : (
          <div className="space-y-3">
            {data.factors.map((f) => (
              <div key={f.factor} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    Stop at {Math.round(f.factor * 100)}% of the current distance
                  </span>
                  <Badge variant={f.supported ? "default" : "outline"}>
                    {f.supported ? "supported by evidence" : "not supported"}
                  </Badge>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <div className="text-xs text-muted-foreground">
                    <div className="text-foreground">Current rule {fmtR(f.baselineMeanR)}</div>
                    <div>same {f.considered} setups</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div className="text-foreground">Conservative {fmtR(f.conservativeMeanR)}</div>
                    <div>{interval(f.conservativeCiLo, f.conservativeCiHi)}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div className="text-foreground">Upper bound {fmtR(f.optimisticMeanR)}</div>
                    <div>not a claim</div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {f.deterministic} proven · {f.ambiguous} unprovable (charged as losses) ·{" "}
                  {f.excluded} not adjudicable · {f.clusterN} independent days · {f.bootstrapStatus}
                </p>
              </div>
            ))}
            {data.not_decidable.length > 0 && (
              <div className="rounded-lg border border-dashed border-border p-3">
                <p className="text-sm font-medium">Cannot be measured from stored history</p>
                <ul className="mt-1 space-y-1">
                  {data.not_decidable.map((nd) => (
                    <li key={nd.rule} className="text-xs text-muted-foreground">
                      <span className="text-foreground">{nd.rule}</span> — needs {nd.missing}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {data.rows_read} resolved replay rows read · as of {utcMinute(data.as_of)} UTC
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
