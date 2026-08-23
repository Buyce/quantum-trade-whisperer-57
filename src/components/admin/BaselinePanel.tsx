/**
 * Quantitative Integrity Baseline panel (owner only).
 *
 * Shows the active model version and the stored baseline document. Capture is a
 * deliberate manual action: the document is immutable and pinned to one learning
 * run, so it must not be produced by a background loop.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  getBaselineStatus,
  runBaselineCapture,
  type BaselineStatus,
} from "@/lib/baseline.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyNote, num, pctOf, timeAgo } from "./AdminPanels";

interface Wilson {
  k: number;
  n: number;
  rate: number | null;
  lo: number | null;
  hi: number | null;
}

interface ShadowBaselineMetrics {
  fill_rate?: Wilson | null;
  win_if_filled?: Wilson | null;
  unconditional_win_per_signal?: number | null;
  mean_r_all_resolved?: number | null;
  resolved?: number;
  never_filled?: number;
}

interface BaselineMetrics {
  shadow_cohort?: ShadowBaselineMetrics;
  caveats?: string[];
}

function CI({ label, ci }: { label: string; ci?: Wilson | null }) {
  if (!ci || ci.n === 0) {
    return (
      <div className="rounded border border-border/60 p-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm text-muted-foreground">no sample</div>
      </div>
    );
  }
  return (
    <div className="rounded border border-border/60 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{pctOf(ci.rate)}</div>
      <div className="text-[10px] text-muted-foreground">
        {ci.k}/{ci.n} · 95% CI {pctOf(ci.lo)}–{pctOf(ci.hi)}
      </div>
    </div>
  );
}

export function BaselinePanel() {
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getBaselineStatus);
  const capture = useServerFn(runBaselineCapture);

  const status = useQuery({
    queryKey: ["admin-baseline-status"],
    queryFn: () => fetchStatus() as Promise<BaselineStatus>,
    refetchOnWindowFocus: false,
    staleTime: 300_000,
  });

  const mutation = useMutation({
    mutationFn: () =>
      capture() as Promise<{
        captured: boolean;
        reason: string | null;
        pinnedRunId: string | null;
      }>,
    onSuccess: (result) => {
      if (result.captured) {
        toast.success("Baseline captured", {
          description: `Pinned to learning run ${String(result.pinnedRunId).slice(0, 8)}.`,
        });
      } else {
        toast.info("Nothing captured", { description: result.reason ?? "Already recorded." });
      }
      void queryClient.invalidateQueries({ queryKey: ["admin-baseline-status"] });
    },
    onError: (e) =>
      toast.error("Capture failed", {
        description: e instanceof Error ? e.message : "Unknown error.",
      }),
  });

  if (status.isLoading) return <Skeleton className="h-32" />;
  if (status.isError) {
    return (
      <EmptyNote>
        {status.error instanceof Error ? status.error.message : "Baseline status unavailable."}
      </EmptyNote>
    );
  }

  const latest = status.data?.latest ?? null;
  const metrics = (latest?.metrics ?? {}) as BaselineMetrics;
  const shadow = metrics.shadow_cohort;
  const caveats = metrics.caveats ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="secondary" className="text-[10px]">
            V{status.data?.modelVersion} · {status.data?.modelLabel}
          </Badge>
          <span>
            {latest
              ? `captured ${timeAgo(latest.captured_at)} · run ${String(latest.pinned_run_id ?? "").slice(0, 8)} · ${status.data?.total} on record`
              : "no baseline recorded yet"}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          <Camera className="size-3.5" />
          {mutation.isPending ? "Capturing…" : "Capture baseline"}
        </Button>
      </div>

      {!latest ? (
        <EmptyNote>
          No immutable baseline exists. Capture one to freeze the current engine&apos;s fill rate,
          win rate and per-cell samples before any remediation changes the numbers.
        </EmptyNote>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <CI label="Fill rate" ci={shadow?.fill_rate ?? null} />
            <CI label="Win if filled" ci={shadow?.win_if_filled ?? null} />
            <div className="rounded border border-border/60 p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Win per signal
              </div>
              <div className="font-mono text-sm">
                {pctOf(shadow?.unconditional_win_per_signal ?? null)}
              </div>
              <div className="text-[10px] text-muted-foreground">fill × win, unconditional</div>
            </div>
            <div className="rounded border border-border/60 p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Mean R (resolved)
              </div>
              <div className="font-mono text-sm">
                {num(shadow?.mean_r_all_resolved ?? null)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                n={shadow?.resolved ?? 0} resolved · {shadow?.never_filled ?? 0} never filled
              </div>
            </div>
          </div>

          <div className="rounded border border-border/60 p-2 text-[11px]">
            <div className="mb-1 flex items-center gap-1 font-medium">
              {caveats.length === 0 ? (
                <ShieldCheck className="size-3.5 text-emerald-400" />
              ) : (
                <TriangleAlert className="size-3.5 text-amber-400" />
              )}
              Recorded caveats ({caveats.length})
            </div>
            {caveats.length === 0 ? (
              <p className="text-muted-foreground">
                No structural limitations recorded for this capture.
              </p>
            ) : (
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                {caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </div>

          <details className="rounded border border-border/60 p-2">
            <summary className="cursor-pointer text-[11px] text-muted-foreground">
              Full baseline document (JSON)
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto text-[10px] leading-tight">
              {JSON.stringify(metrics, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}
