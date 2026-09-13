/**
 * Owner-only view of the retention clean-up jobs.
 *
 * Every number is read from the database: how many setups are archived, when
 * the last archive row was written, and the real outcome of the last run of each
 * clean-up job. A failed run is shown with the database's own message, never
 * smoothed into "healthy".
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { PanelShell } from "@/components/admin/AdminPanels";
import { Skeleton } from "@/components/ui/skeleton";
import { getCleanupHealth } from "@/lib/datasets/cleanup.functions";

const JOB_LABELS: Record<string, string> = {
  "purge-expired-signals": "Setup retention (archive, then remove from feed)",
  "telemetry-rollup": "Measurement history trim",
  "purge-cancelled-accounts": "Closed-account removal",
};

function when(value: string | null): string {
  if (!value) return "never";
  return new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function CleanupHealthPanel() {
  const fn = useServerFn(getCleanupHealth);
  const health = useQuery({
    queryKey: ["cleanup-health"],
    queryFn: () => fn(),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  return (
    <PanelShell title="Data retention health">
      <p className="mb-3 text-xs text-muted-foreground">
        Setups leave the feed on a grade-tiered schedule, but only after a full copy is written to
        the permanent archive. Learning rows are never deleted.
      </p>
      {health.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : health.isError ? (
        <p className="text-sm text-destructive">
          {health.error instanceof Error
            ? health.error.message
            : "Could not read retention health."}
        </p>
      ) : health.data ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Archived setups</p>
              <p className="text-lg font-semibold">{health.data.archivedSignals}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">In the live feed</p>
              <p className="text-lg font-semibold">{health.data.liveSignals}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last archived</p>
              <p className="text-sm font-medium">{when(health.data.archivedLastAt)}</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-3">Job</th>
                  <th className="py-1 pr-3">Schedule</th>
                  <th className="py-1 pr-3">Last run</th>
                  <th className="py-1">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {health.data.jobs.map((job) => (
                  <tr key={job.job} className="border-t border-border/60 align-top">
                    <td className="py-1.5 pr-3">{JOB_LABELS[job.job] ?? job.job}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{job.schedule}</td>
                    <td className="py-1.5 pr-3">{when(job.lastRunAt)}</td>
                    <td className="py-1.5">
                      <span
                        className={
                          job.lastStatus === "succeeded"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : job.lastStatus
                              ? "text-destructive"
                              : "text-muted-foreground"
                        }
                      >
                        {job.lastStatus ?? "no run recorded"}
                      </span>
                      {job.lastStatus && job.lastStatus !== "succeeded" && job.lastMessage ? (
                        <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
                          {job.lastMessage}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </PanelShell>
  );
}
