/**
 * The engine's own record of what it decided about your automatic orders.
 *
 * Without this, an empty order list has two very different meanings that look
 * identical: "your rules excluded everything" and "the engine never tried". Each
 * row below is a decision the engine actually recorded — nothing is inferred, and
 * an empty log says only that no decision has been recorded yet.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAutoOrderDecisions } from "@/lib/execution.functions";
import { describeEnqueueDecision } from "@/lib/delivery/enqueue-log";
import { INSTRUMENT_LABELS } from "@/lib/db-types";

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown time";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AutoOrderDecisions() {
  const load = useServerFn(getAutoOrderDecisions);
  const decisions = useQuery({
    queryKey: ["auto-order-decisions"],
    queryFn: () => load(),
    staleTime: 30_000,
  });

  return (
    <div className="rounded-sm border border-border/60 bg-background/40 p-3">
      <h3 className="label-xs">Last automatic-order decisions</h3>

      {decisions.isLoading ? (
        <p className="mt-2 text-xs text-muted-foreground">Reading the decision log…</p>
      ) : decisions.isError ? (
        <p className="mt-2 text-xs text-warning">
          The decision log could not be read, so nothing is claimed here about what the engine did.
        </p>
      ) : (decisions.data ?? []).length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No decision has been recorded yet. That means the engine has not published a setup since
          this log started — it does not mean an order was refused.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {(decisions.data ?? []).map((d, i) => (
            <li
              key={`${d.at}-${i}`}
              className="border-b border-border/40 pb-2 last:border-b-0 last:pb-0"
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs font-medium text-foreground">
                  {d.instrument ? (INSTRUMENT_LABELS[d.instrument] ?? d.instrument) : "System"}
                </span>
                {d.grade ? (
                  <span className="text-[11px] text-muted-foreground">{d.grade}-Grade</span>
                ) : null}
                <span className="text-[11px] text-muted-foreground">{when(d.at)}</span>
                <span
                  className={`text-[11px] font-medium ${
                    d.enqueued > 0 ? "text-success" : "text-muted-foreground"
                  }`}
                >
                  {d.enqueued > 0 ? "order queued" : "no order"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {describeEnqueueDecision(d.decision)}
                {d.detail && d.decision !== "enqueued" ? ` (${d.detail})` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
