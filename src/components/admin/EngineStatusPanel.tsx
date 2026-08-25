/**
 * Engine status panel (owner only).
 *
 * Deliberately splits two things that were previously collapsed into one
 * "Scan engine" tile:
 *  - the live 15-minute SCANNER, whose health is `scan_queue` outcomes;
 *  - the SHADOW REPLAY / statistics engine, whose circuit breaker is
 *    `shadow_engine_state.paused`.
 * A tripped replay breaker does not pause live scanning, and the copy here says
 * so explicitly. Provider refusals are labelled as missing data, never as a
 * scanner-wide "No Trade".
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RotateCcw } from "lucide-react";
import { getAdminEngineStatus, resetShadowBreaker } from "@/lib/admin.functions";
import {
  classifyEngineError,
  classifyReplayHealth,
  classifyScanHealth,
  cooldownRemaining,
} from "@/lib/engine-status";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { PanelShell, StatCard, timeAgo } from "@/components/admin/AdminPanels";

export function EngineStatusPanel() {
  const fetchStatus = useServerFn(getAdminEngineStatus);
  const resetFn = useServerFn(resetShadowBreaker);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-engine-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: 45_000,
  });

  const reset = useMutation({
    mutationFn: () => resetFn(),
    onSuccess: () => {
      toast.success("Replay breaker cleared", {
        description: "The next hourly resolve pass will run immediately.",
      });
      void queryClient.invalidateQueries({ queryKey: ["admin-engine-status"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-intelligence"] });
    },
    onError: (err) =>
      toast.error("Reset failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      }),
  });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  const scan = data.scan;
  const breaker = data.breaker;
  const scanClass = classifyEngineError(scan.last_error);
  const breakerClass = classifyEngineError(breaker?.last_error ?? null);
  const health = classifyScanHealth(scan);
  const replayHealth = classifyReplayHealth(breaker);
  const cooldown = cooldownRemaining(breaker?.paused_until ?? null);

  const scanSub =
    health.state === "recovered"
      ? `${scan.succeeded}/${scan.total} jobs ok in the rolling ${scan.window_minutes}m window · recovered: last failure ${timeAgo(scan.last_failure_at)}, last cycle ok ${timeAgo(scan.last_success_at)}`
      : `${scan.succeeded}/${scan.total} jobs ok in the rolling ${scan.window_minutes}m window · last cycle ${timeAgo(scan.last_finished_at)}`;

  return (
    <PanelShell
      title="Engine status"
      right={
        <span className="text-[10px] text-muted-foreground">
          two independent engines · the replay breaker never pauses live scanning
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <StatCard
          label="Scan engine (15-min cycles)"
          value={health.value}
          sub={scanSub}
          tone={health.tone}
          hint="Derived from scan_queue outcomes in a rolling window only — a failure inside the window is not evidence of a failure now, and this never reads the replay engine's pause flag."
        />
        <StatCard
          label="Shadow replay engine"
          value={replayHealth.value}
          sub={
            breaker?.paused
              ? cooldown
                ? `retry probe in ${cooldown} · ${breaker.consecutive_failures} consecutive failed passes`
                : `probe pass due now · ${breaker.consecutive_failures} consecutive failed passes`
              : `last run ${timeAgo(breaker?.last_run_at ?? null)} · ${breaker?.consecutive_failures ?? 0} consecutive failures`
          }
          tone={replayHealth.tone}
          hint="Statistics/replay only. Live signal scanning and delivery are unaffected by this flag."
        />
      </div>

      {(scanClass.kind !== "none" || breakerClass.kind !== "none") && (
        <div className="mt-3 space-y-2 text-[11px]">
          {scanClass.kind !== "none" &&
            (health.errorIsCurrent ? (
              <p className="text-muted-foreground">
                <span className="font-medium text-amber-400">Scanner: {scanClass.label}.</span>{" "}
                {scanClass.explanation}
                <span className="mt-1 block break-all font-mono text-[10px] text-muted-foreground/80">
                  {scan.last_error}
                </span>
              </p>
            ) : (
              <p className="text-muted-foreground/80">
                <span className="font-medium">
                  Last failure in this window (since recovered): {scanClass.label}.
                </span>{" "}
                {scanClass.explanation} Cycles after it completed normally, so this no longer
                describes the scanner&apos;s current state.
                <span className="mt-1 block break-all font-mono text-[10px] text-muted-foreground/70">
                  {scan.last_error}
                </span>
              </p>
            ))}
          {breakerClass.kind !== "none" && (
            <p className="text-muted-foreground">
              <span className="font-medium text-amber-400">Replay: {breakerClass.label}.</span>{" "}
              {breakerClass.explanation}
              <span className="mt-1 block break-all font-mono text-[10px] text-muted-foreground/80">
                {breaker?.last_error}
              </span>
            </p>
          )}
        </div>
      )}

      {breaker?.paused && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => reset.mutate()}
            disabled={reset.isPending}
          >
            <RotateCcw className={reset.isPending ? "size-3.5 animate-spin" : "size-3.5"} />
            Clear replay breaker
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Clears the pause, failure counter and cooldown. Only useful once the data provider is
            serving candles again.
          </span>
        </div>
      )}
    </PanelShell>
  );
}
