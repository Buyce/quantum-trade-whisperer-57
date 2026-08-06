import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Filter, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  instrumentHealthQuery,
  logDecision,
  myTradesQuery,
  settingsQuery,
  signalsQuery,
  updateTradeResult,
} from "@/lib/queries";
import { contextOf, type Grade, type SignalRow, type TradeRow } from "@/lib/db-types";
import { SignalCard } from "@/components/SignalCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/feed")({
  head: () => ({
    meta: [
      { title: "Signal Feed — P-Trades Hub" },
      {
        name: "description",
        content: "Graded ABC retracement trade profiles with entry, stop, targets, R:R and confidence score.",
      },
      { property: "og:title", content: "Signal Feed — P-Trades Hub" },
      { property: "og:description", content: "Live graded forex trade profiles with confidence scoring." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FeedPage,
});

const GRADE_ORDER: Record<Grade, number> = { A: 3, B: 2, C: 1 };

function FeedPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const signals = useQuery(signalsQuery());
  const trades = useQuery(myTradesQuery(user?.id));
  const settings = useQuery(settingsQuery(user?.id));
  const health = useQuery(instrumentHealthQuery());

  const [busyId, setBusyId] = useState<string | null>(null);
  const [applyFilters, setApplyFilters] = useState(true);
  const [openOnly, setOpenOnly] = useState(false);

  // Realtime: new scanner output pushes straight into the feed.
  useEffect(() => {
    const channel = supabase
      .channel("scanned-signals-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "scanned_signals" }, (payload) => {
        const row = payload.new as { instrument?: string; grade?: string };
        toast.info(`New ${row.grade ?? ""}-Grade setup on ${row.instrument ?? "market"}`);
        void queryClient.invalidateQueries({ queryKey: ["signals"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const tradeBySignal = useMemo(() => {
    const map = new Map<string, TradeRow>();
    for (const t of trades.data ?? []) map.set(t.signal_id, t);
    return map;
  }, [trades.data]);

  const cfg = settings.data;

  const visible = useMemo(() => {
    let rows: SignalRow[] = signals.data ?? [];
    if (applyFilters && cfg) {
      rows = rows.filter((s) => {
        if (cfg.instruments.length && !cfg.instruments.includes(s.instrument)) return false;
        if (GRADE_ORDER[s.grade] < GRADE_ORDER[cfg.min_grade]) return false;
        const ctx = contextOf(s);
        if (cfg.sessions.length && ctx && !cfg.sessions.includes(ctx.trading_session)) return false;
        return true;
      });
    }
    if (openOnly) rows = rows.filter((s) => s.status === "active");
    return rows;
  }, [signals.data, applyFilters, cfg, openOnly]);

  const todayCount = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return (signals.data ?? []).filter((s) => new Date(s.detected_at) >= start).length;
  }, [signals.data]);

  const cap = cfg?.daily_setup_cap ?? 15;
  const unavailable = (health.data ?? []).filter((h) => !h.available);

  async function decide(signalId: string, decision: "taken" | "skipped") {
    if (!user) return;
    setBusyId(signalId);
    try {
      await logDecision({ signalId, userId: user.id, decision });
      await queryClient.invalidateQueries({ queryKey: ["my-trades"] });
      toast.success(decision === "taken" ? "Logged as taken" : "Logged as skipped");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not log the decision");
    } finally {
      setBusyId(null);
    }
  }

  async function close(tradeId: string, outcome: "win" | "loss" | "breakeven", r: number) {
    setBusyId(tradeId);
    try {
      await updateTradeResult({ tradeId, outcome, realizedR: r });
      await queryClient.invalidateQueries({ queryKey: ["my-trades"] });
      toast.success(`Result recorded at ${r.toFixed(2)}R`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the result");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className="label-xs">Phase 2 · Trade assistant</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Signal Feed</h1>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-4">
          <div className="rounded-md border border-border bg-card px-3 py-2">
            <p className="label-xs">Setups today</p>
            <p className="num text-sm font-semibold">
              <span className={cn(todayCount >= cap ? "text-destructive" : "text-foreground")}>{todayCount}</span>
              <span className="text-muted-foreground"> / {cap}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="apply-filters" checked={applyFilters} onCheckedChange={setApplyFilters} />
            <Label htmlFor="apply-filters" className="text-xs text-muted-foreground">
              <Filter className="mr-1 inline size-3.5" />
              My settings filter
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="open-only" checked={openOnly} onCheckedChange={setOpenOnly} />
            <Label htmlFor="open-only" className="text-xs text-muted-foreground">
              Active only
            </Label>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["signals"] })}
          >
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </div>

      {applyFilters && cfg ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="label-xs">Filtering</span>
          {cfg.instruments.map((i) => (
            <Badge key={i} variant="outline" className="num font-normal">
              {i}
            </Badge>
          ))}
          <Badge variant="outline" className="num font-normal">
            min {cfg.min_grade}-grade
          </Badge>
          {cfg.sessions.map((s) => (
            <Badge key={s} variant="outline" className="num font-normal">
              {s.replace(/_/g, " ")}
            </Badge>
          ))}
        </div>
      ) : null}

      {unavailable.length ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 text-warning" />
          <p className="text-foreground/90">
            Temporarily unavailable market data:{" "}
            <span className="num">{unavailable.map((h) => h.instrument).join(", ")}</span>. The scanner skipped
            these instruments and will retry on the next cycle.
          </p>
        </div>
      ) : null}

      {signals.isLoading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : signals.isError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          Could not load signals. Try refreshing.
        </p>
      ) : visible.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-6 py-16 text-center">
          <p className="num text-lg font-semibold text-foreground">NO TRADE</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            No setup currently satisfies your grading and session filters. This is the system default, not an
            error — the scanner only publishes structures that pass the ABC rules.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((signal) => {
            const trade = tradeBySignal.get(signal.id);
            return (
              <SignalCard
                key={signal.id}
                signal={signal}
                trade={trade}
                busy={busyId === signal.id || busyId === trade?.id}
                onDecision={(d) => void decide(signal.id, d)}
                onResult={(outcome, r) => {
                  if (trade) void close(trade.id, outcome, r);
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
