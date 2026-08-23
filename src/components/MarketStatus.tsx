import { useEffect, useMemo, useState } from "react";
import { formatDuration, marketStatus } from "@/lib/market-hours";
import { cn } from "@/lib/utils";

export interface MarketStatusHealth {
  instrument: string;
  available: boolean;
  unavailable_until: string | null;
}

/**
 * Live session strip: which FX sessions are open right now, the weekend
 * closure, and whether the broker feed for each traded instrument is reachable.
 *
 * Purely presentational — session state is derived from the clock (same UTC
 * boundaries the scanner uses) and instrument state is read from the
 * instrument_health rows the scanner already writes.
 */
export function MarketStatus({ health }: { health?: MarketStatusHealth[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const status = useMemo(() => marketStatus(new Date(now)), [now]);
  const rows = health ?? [];

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="label-xs">Market hours</span>
        {status.weekendClosed ? (
          <span className="num text-xs text-warning">
            Market closed — weekend
            {status.minutesToReopen
              ? ` · reopens in ${formatDuration(status.minutesToReopen)}`
              : ""}
          </span>
        ) : (
          <span className="num text-xs text-muted-foreground">
            {status.openCount} of {status.sessions.length} sessions open · scanner session{" "}
            {status.scannerSession.replace(/_/g, " ")}
          </span>
        )}
      </div>

      <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {status.sessions.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                s.open ? "bg-success" : "bg-muted-foreground/40",
              )}
            />
            <span className="min-w-0 text-foreground">{s.label}</span>
            <span className="num ml-auto whitespace-nowrap text-muted-foreground">
              {status.weekendClosed ? (
                "closed"
              ) : (
                <>
                  <span className="sm:hidden">
                    {s.open
                      ? `${formatDuration(s.minutesToChange)} left`
                      : `in ${formatDuration(s.minutesToChange)}`}
                  </span>
                  <span className="hidden sm:inline">
                    {s.open
                      ? `closes in ${formatDuration(s.minutesToChange)}`
                      : `opens in ${formatDuration(s.minutesToChange)}`}
                  </span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      {rows.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-3">
          {rows.map((h) => (
            <span key={h.instrument} className="flex items-center gap-1.5 text-xs">
              <span
                aria-hidden
                className={cn("size-2 rounded-full", h.available ? "bg-success" : "bg-destructive")}
              />
              <span className="num text-foreground">{h.instrument}</span>
              <span className="text-muted-foreground">
                {h.available ? "live feed" : "feed down"}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
