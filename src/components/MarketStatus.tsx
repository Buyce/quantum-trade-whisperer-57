import { useEffect, useMemo, useState } from "react";
import { type InstrumentCapability, instrumentCapability } from "@/lib/db-types";
import { formatDuration, marketStatus } from "@/lib/market-hours";
import { cn } from "@/lib/utils";

export interface MarketStatusHealth {
  instrument: string;
  available: boolean;
  unavailable_until: string | null;
}

export interface InstrumentStageRow {
  symbol: string;
  stage: string;
}

/**
 * What the chip says. Feed reachability alone is NOT a claim of availability: a
 * pair in measurement has a reachable broker feed while still being forbidden
 * from publishing, alerting or executing.
 */
export function feedChipLabel(available: boolean, capability: InstrumentCapability): string {
  if (!available) return "feed down";
  if (capability === "publishable") return "live feed";
  if (capability === "measuring") return "measuring — not published yet";
  return "not in service";
}

/**
 * Live session strip: which FX sessions are open right now, the weekend
 * closure, and whether the broker feed for each traded instrument is reachable.
 *
 * Purely presentational — session state is derived from the clock (same UTC
 * boundaries the scanner uses) and instrument state is read from the
 * instrument_health rows the scanner already writes.
 */
export function MarketStatus({
  health,
  stages,
}: {
  health?: MarketStatusHealth[];
  stages?: InstrumentStageRow[];
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const status = useMemo(() => marketStatus(new Date(now)), [now]);
  const rows = health ?? [];
  const measuring = rows.filter(
    (h) => h.available && instrumentCapability(h.instrument, stages) === "measuring",
  );

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
        <div className="mt-3 border-t border-border pt-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {rows.map((h) => {
              const capability = instrumentCapability(h.instrument, stages);
              return (
                <span key={h.instrument} className="flex items-center gap-1.5 text-xs">
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 rounded-full",
                      !h.available
                        ? "bg-destructive"
                        : capability === "publishable"
                          ? "bg-success"
                          : "bg-muted-foreground/60",
                    )}
                  />
                  <span className="num text-foreground">{h.instrument}</span>
                  <span className="text-muted-foreground">
                    {feedChipLabel(h.available, capability)}
                  </span>
                </span>
              );
            })}
          </div>
          {measuring.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Measuring instruments are being validated against live broker data. They produce no
              signals, alerts or orders yet, and become selectable in Settings only once they are
              promoted.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
