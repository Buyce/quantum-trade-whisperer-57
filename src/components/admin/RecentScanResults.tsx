/**
 * Scan outcomes over the last 3 hours, shown beneath the 24-hour totals.
 *
 * The 24-hour figures keep counting a fault for a full day after it was fixed,
 * which reads as "still broken". This short window states the present without
 * hiding the day's history: both are shown, neither replaces the other. Counts
 * come straight from the queue — nothing is inferred and nothing is smoothed.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminScanResultsRecent } from "@/lib/admin.functions";

export function RecentScanResults() {
  const load = useServerFn(getAdminScanResultsRecent);
  const { data, isError } = useQuery({
    queryKey: ["admin-scan-results-recent"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (isError) {
    return (
      <p className="mt-2 border-t border-border/40 pt-2 text-[11px] text-warning">
        The last 3 hours could not be read, so only the 24-hour totals above are known.
      </p>
    );
  }
  if (!data) return null;

  const entries = Object.entries(data.results);
  return (
    <div className="mt-2 border-t border-border/40 pt-2">
      <p className="mb-1 text-[10px] tracking-wide text-muted-foreground uppercase">
        last 3 hours · {data.total} jobs
      </p>
      {entries.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No scan cycles in the last 3 hours.</p>
      ) : (
        <ul className="space-y-1 font-mono text-[11px]">
          {entries.map(([k, v]) => (
            <li key={k} className="flex justify-between">
              <span className="text-muted-foreground">{k}</span>
              <span>{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
