import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, Filter, RefreshCw } from "lucide-react";
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
import { contextOf, isWithinRetention, type Grade, type SignalRow, type TradeRow } from "@/lib/db-types";
import { SignalCard } from "@/components/SignalCard";
import { ScanHeartbeat } from "@/components/ScanHeartbeat";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import { useGuideMode } from "@/components/GuideMode";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { downloadJson, signalsToExportJson, todayStamp } from "@/lib/export";
import { useQuotes } from "@/lib/useQuotes";
import { riskProfileFromSettings } from "@/lib/risk";
import { recordSignalEvent } from "@/lib/telemetry.functions";

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

const GRADE_ORDER: Record<Grade, number> = { "A+": 4, A: 3, B: 2, C: 1 };

function FeedPage() {
  const { user } = useAuth();
  const { guide } = useGuideMode();
  const queryClient = useQueryClient();
  const signals = useQuery(signalsQuery());
  const trades = useQuery(myTradesQuery(user?.id));
  const settings = useQuery(settingsQuery(user?.id));
  const health = useQuery(instrumentHealthQuery());
  // One shared cached quote poll for the whole page — cards read from this map.
  const { quotes, rates } = useQuotes();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [applyFilters, setApplyFilters] = useState(true);
  const [openOnly, setOpenOnly] = useState(false);

  // Per-user alert threshold, independent of the feed filter.
  const alertMinGrade: Grade = settings.data?.alert_min_grade ?? "B";
  // Held in a ref so the realtime channel is never torn down and rebuilt just
  // because settings loaded or changed — resubscribing drops INSERTs in the gap.
  const alertMinGradeRef = useRef<Grade>(alertMinGrade);
  useEffect(() => {
    alertMinGradeRef.current = alertMinGrade;
  }, [alertMinGrade]);

  // Realtime: new scanner output pushes straight into the feed.
  useEffect(() => {
    const channel = supabase
      .channel("scanned-signals-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "scanned_signals" }, (payload) => {
        const row = payload.new as { instrument?: string; grade?: Grade; direction?: string };
        const title = `New ${row.grade === "A+" ? "A+" : `${row.grade ?? ""}-`}Grade setup on ${row.instrument ?? "market"}`;
        toast.info(title);
        const rank = row.grade ? (GRADE_ORDER[row.grade] ?? 0) : 0;
        const meetsAlertThreshold = rank >= GRADE_ORDER[alertMinGradeRef.current];
        if (
          meetsAlertThreshold &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          new Notification("P-Trades Hub", {
            body: `${title}${row.direction ? ` · ${row.direction.toUpperCase()}` : ""}`,
            tag: "ptrades-signal",
          });
        }
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
    // Retention cutoff: a setup leaves the feed once its grade window elapses,
    // even when the row survives deletion because a trade was logged on it.
    const now = Date.now();
    rows = rows.filter((s) => isWithinRetention(s, now));
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

  // Only A+/A/B consume the daily quota — C-Grade publishes outside the cap.
  // Window is UTC midnight so the number matches the scanner's own quota query.
  const todayCount = useMemo(() => {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return (signals.data ?? []).filter(
      (s) => new Date(s.detected_at) >= start && s.grade !== "C",
    ).length;
  }, [signals.data]);

  const cap = cfg?.daily_setup_cap ?? 50;
  const unavailable = (health.data ?? []).filter((h) => !h.available);
  const lastScanAt = (health.data ?? []).find((h) => h.instrument === "XAUUSD")?.updated_at ?? null;

  function exportSignals() {
    if (visible.length === 0) return;
    downloadJson(`ptrades_signals_export_${todayStamp()}.json`, signalsToExportJson(visible));
    toast.success(`Exported ${visible.length} setup${visible.length === 1 ? "" : "s"}`);
  }

  async function decide(signalId: string, decision: "taken" | "skipped") {
    if (!user) return;
    setBusyId(signalId);
    try {
      await logDecision({ signalId, userId: user.id, decision });
      // Behavioural telemetry for the shadow ML dataset. Fire-and-forget: it
      // must never delay the button or surface an error to the trader.
      void recordSignalEvent({ data: { signalId, event: decision } }).catch(() => {});
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

  // One summary chip instead of a wall of badges: the detail lives in the popover.
  const filterSummary = !applyFilters
    ? "All published setups"
    : cfg
      ? [
          `${cfg.instruments.length || "all"} instrument${cfg.instruments.length === 1 ? "" : "s"}`,
          `min ${cfg.min_grade}`,
          `${cfg.sessions.length || "all"} session${cfg.sessions.length === 1 ? "" : "s"}`,
          openOnly ? "active only" : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "My settings filter";

  const capPct = Math.min(100, cap > 0 ? (todayCount / cap) * 100 : 0);

  return (
    <div className="space-y-5">
      <OnboardingBanner />

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap">
        <div className="min-w-0">
          <p className="label-xs">Phase 2 · Trade assistant</p>
          <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">Signal Feed</h1>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline">
                <Filter className="size-4" /> Filters
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <Label htmlFor="apply-filters" className="text-xs leading-snug text-foreground">
                  My settings filter
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    Apply your instruments, minimum grade and sessions.
                  </span>
                </Label>
                <Switch id="apply-filters" checked={applyFilters} onCheckedChange={setApplyFilters} />
              </div>
              <div className="flex items-start justify-between gap-3">
                <Label htmlFor="open-only" className="text-xs leading-snug text-foreground">
                  Active only
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    Hide setups the scanner has already resolved.
                  </span>
                </Label>
                <Switch id="open-only" checked={openOnly} onCheckedChange={setOpenOnly} />
              </div>
              {applyFilters && cfg ? (
                <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
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
            </PopoverContent>
          </Popover>

          <Button
            size="sm"
            variant="ghost"
            aria-label="Refresh signals"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["signals"] })}
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Export signals as JSON"
            disabled={visible.length === 0}
            onClick={exportSignals}
          >
            <Download className="size-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <Badge variant="secondary" className="num max-w-full whitespace-normal text-left font-normal">
            {filterSummary}
          </Badge>
          <span className="num">
            {visible.length} shown
          </span>
          <span className="num w-full sm:ml-auto sm:w-auto">
            Daily quota (A+/A/B){" "}
            <span className={cn("font-semibold", todayCount >= cap ? "text-destructive" : "text-foreground")}>
              {todayCount}
            </span>
            /{cap}
          </span>
        </div>
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-border">
          <div
            className={cn("h-full rounded-full", todayCount >= cap ? "bg-destructive" : "bg-primary")}
            style={{ width: `${capPct}%` }}
          />
        </div>
      </div>


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
        <div className="rounded-md border border-border bg-card px-4 py-10 text-center sm:px-6 sm:py-16">
          <p className="num text-lg font-semibold text-foreground">
            {guide ? "CAPITAL PRESERVATION MODE" : "NO TRADE"}
          </p>
          {guide ? (
            <div className="mx-auto mt-3 max-w-lg space-y-3 text-sm text-muted-foreground">
              <p>
                Nothing here means nothing qualified — and that is a result, not a failure. The scanner keeps
                your capital flat until a setup earns its place.
              </p>
              <p>
                It re-checks XAUUSD, GBPAUD and EURUSD every 15 minutes. New setups appear here automatically,
                so you can close the tab and come back later.
              </p>
              <p className="text-xs">
                Waiting too long? Loosen the minimum grade or add sessions in Settings, or turn off "My settings
                filter" above to see everything the scanner published.
              </p>
            </div>
          ) : (
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              No setup currently satisfies your grading and session filters. This is the system default, not an
              error — the scanner only publishes structures that pass the ABC rules.
            </p>
          )}
          <div className="mt-6">
            <ScanHeartbeat lastScanAt={lastScanAt} />
          </div>
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
                quoteMid={quotes[signal.instrument]?.mid}
                orderStrategy={settings.data?.order_strategy ?? "smart_adaptive"}
                riskProfile={riskProfileFromSettings(settings.data)}
                fxRates={rates}
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
