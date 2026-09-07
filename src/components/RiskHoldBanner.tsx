/**
 * One notice for an active automatic-order hold, with a live countdown.
 *
 * Every field is read from the persisted brake state, which is written from
 * CLOSED broker trades and the broker's own equity reading. Nothing here is
 * inferred: when the state cannot be read the banner says so and claims nothing,
 * and when no hold is recorded it renders nothing at all — an absent hold is not
 * a promise that no risk exists.
 *
 * It replaces the same long sentence repeated on every refused row: the rows now
 * say "held by your risk rules" and this banner carries the reason and the time.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getRiskHolds } from "@/lib/execution.functions";
import { BRAKE_REASON_COPY, type BrakeReason } from "@/lib/risk/brakes";

function countdown(target: number, nowMs: number): string {
  const ms = target - nowMs;
  if (ms <= 0) return "due now";
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

export function RiskHoldBanner() {
  const load = useServerFn(getRiskHolds);
  const holds = useQuery({
    queryKey: ["risk-holds"],
    queryFn: () => load(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Ticks only so the countdown stays honest; it never changes the stored state.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (holds.isLoading) return null;
  if (holds.isError) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
        <p className="text-warning">
          Your automatic-order holds could not be read just now, so nothing is claimed here about
          whether one is active.
        </p>
      </div>
    );
  }

  const rows = holds.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      {rows.map((hold) => {
        const resumeMs = hold.resumeAfter ? Date.parse(hold.resumeAfter) : NaN;
        const startedMs = hold.pausedAt ? Date.parse(hold.pausedAt) : NaN;
        const reasonCopy =
          hold.reason && hold.reason in BRAKE_REASON_COPY
            ? BRAKE_REASON_COPY[hold.reason as BrakeReason]
            : "One of your own risk rules is holding new automatic orders on this account.";
        return (
          <div
            key={hold.accountId}
            className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
          >
            <p className="font-medium text-warning">New automatic orders are paused</p>
            <p className="mt-1 text-muted-foreground">
              {reasonCopy} It stops new orders only — anything already resting or filled at your
              broker is untouched and stays yours to manage there.
            </p>
            <p className="mt-1 text-muted-foreground">
              {Number.isFinite(startedMs)
                ? `Started ${new Date(startedMs).toISOString().slice(11, 16)} UTC. `
                : ""}
              {Number.isFinite(resumeMs)
                ? `Orders resume ${countdown(resumeMs, nowMs)}, at ${new Date(resumeMs).toISOString().slice(11, 16)} UTC.`
                : "No release time has been recorded yet, so none is shown."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              You choose both the losing-run length and how long the pause lasts in Settings, under
              Automatic order rules.
            </p>
          </div>
        );
      })}
    </div>
  );
}
