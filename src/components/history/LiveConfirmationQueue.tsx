/**
 * Live order confirmation queue.
 *
 * Accounts set to Live Confirm never get orders placed for them automatically.
 * This panel lists the requests waiting on YOU, with the time left to decide and
 * whatever risk figures were actually recorded for the order.
 *
 * Confirming records consent to ATTEMPT the order. It is not a fill: P-Trades
 * still re-checks your account, a fresh broker quote and every one of your rules
 * at submission, and the order can still be refused after you confirm.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Clock, X } from "lucide-react";
import {
  confirmLiveOrder,
  declineLiveOrder,
  getLiveConfirmationQueue,
} from "@/lib/delivery/confirmation.functions";
import { GradeBadge } from "@/components/SignalCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { SignalGrade } from "@/lib/db-types";

function countdown(msRemaining: number | null): string {
  if (msRemaining === null) return "no window recorded";
  if (msRemaining <= 0) return "window passed";
  const total = Math.floor(msRemaining / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s left`;
}

export function LiveConfirmationQueue() {
  const queryClient = useQueryClient();
  const fetchQueue = useServerFn(getLiveConfirmationQueue);
  const confirmOne = useServerFn(confirmLiveOrder);
  const declineOne = useServerFn(declineLiveOrder);
  const [busy, setBusy] = useState<number | null>(null);
  const [, setTick] = useState(0);

  const queue = useQuery({
    queryKey: ["live-confirmation-queue"],
    queryFn: () => fetchQueue(),
    refetchInterval: 15_000,
  });

  // Re-render once a second so the countdown is honest rather than stale.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  async function act(deliveryId: number, kind: "confirm" | "decline") {
    setBusy(deliveryId);
    try {
      const result =
        kind === "confirm"
          ? await confirmOne({ data: { deliveryId } })
          : await declineOne({ data: { deliveryId } });
      if (!result.ok) toast.error(result.error);
      else if (kind === "confirm")
        toast.success("Confirmed — P-Trades will now attempt this order at your broker");
      else toast.success("Declined — this order will not be placed");
      await queryClient.invalidateQueries({ queryKey: ["live-confirmation-queue"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (queue.isLoading) return <Skeleton className="h-24 w-full" />;

  const rows = (queue.data ?? []).filter((row) => row.status === "awaiting");

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-xs">Live Confirm</p>
          <h2 className="text-base font-semibold text-foreground">Orders waiting on you</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Confirming records your consent to attempt the order. It is not a fill: your account,
            a fresh broker quote and all of your own limits are re-checked at submission, so an
            order can still be refused after you confirm.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No live order requests are waiting on you right now. This says nothing about the scanner
          or your broker — only that this queue is empty.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li
              key={row.deliveryId}
              className="rounded-md border border-warning/40 bg-warning/5 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                {row.grade ? <GradeBadge grade={row.grade as SignalGrade} /> : null}
                <span className="font-semibold text-foreground">{row.instrument ?? "—"}</span>
                <span className="text-sm uppercase text-muted-foreground">
                  {row.direction ?? "—"}
                </span>
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-warning">
                  <Clock className="h-3.5 w-3.5" />
                  {countdown(row.msRemaining)}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                <span>Entry {row.entryPrice ?? "not recorded"}</span>
                <span>Stop {row.stopLoss ?? "not recorded"}</span>
                <span>
                  Risk{" "}
                  {row.riskAmount === null
                    ? "not recorded"
                    : `${row.riskAmount} ${row.riskCurrency ?? ""}`.trim()}
                </span>
                <span>
                  Of equity{" "}
                  {row.riskPercentOfEquity === null
                    ? "not recorded"
                    : `${row.riskPercentOfEquity}%`}
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  disabled={busy === row.deliveryId}
                  onClick={() => act(row.deliveryId, "confirm")}
                >
                  <Check className="mr-1 h-4 w-4" /> Confirm order
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === row.deliveryId}
                  onClick={() => act(row.deliveryId, "decline")}
                >
                  <X className="mr-1 h-4 w-4" /> Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
