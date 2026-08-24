/**
 * What your current rules mean for REAL automatic orders.
 *
 * Everything here is derived from live state — your saved rules, your armed
 * accounts as the broker reports them, and the same UTC-day sequence the engine
 * uses for the cap. Nothing is a second set of switches, and no figure is
 * invented: an unavailable number is labelled unavailable, never shown as zero.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listConnectedAccounts } from "@/lib/accounts.functions";
import { dayFrameQuery } from "@/lib/queries";
import { countEligibleGradedToday, type EligibilitySettings } from "@/lib/delivery/eligibility";
import { INSTRUMENT_LABELS, SESSION_LABELS, type Grade } from "@/lib/db-types";
import { money } from "@/lib/risk";
import type { ConnectedAccountView } from "@/lib/accounts/types";

export interface AutoTradingSummaryProps {
  instruments: string[];
  sessions: string[];
  alertMinGrade: Grade;
  cap: number;
  equity: string;
  currency: string;
  riskPercent: string;
  maxLots: string;
}

const GRADE_COPY: Record<string, string> = {
  "A+": "A+ only",
  A: "A and above",
  B: "B and above",
  C: "B and above (C is never executed automatically)",
};

/** Armed = the account is set to place orders automatically right now. */
export function armedAccounts(accounts: ConnectedAccountView[]): ConnectedAccountView[] {
  return accounts.filter((a) => a.mode === "demo_auto" || a.mode === "live_auto");
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 py-1.5 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground">{children}</span>
    </div>
  );
}

export function AutoTradingSummary(props: AutoTradingSummaryProps) {
  const { instruments, sessions, alertMinGrade, cap, equity, currency, riskPercent, maxLots } = props;
  const loadAccounts = useServerFn(listConnectedAccounts);
  const accounts = useQuery({
    queryKey: ["connected-accounts", "auto-summary"],
    queryFn: () => loadAccounts(),
  });
  const dayFrame = useQuery(dayFrameQuery());

  const eligibility: EligibilitySettings = useMemo(
    () => ({
      instruments,
      sessions,
      min_grade: alertMinGrade,
      alert_min_grade: alertMinGrade,
      daily_setup_cap: cap,
    }),
    [instruments, sessions, alertMinGrade, cap],
  );

  const usedToday = useMemo(() => {
    if (!dayFrame.data) return null;
    return countEligibleGradedToday(dayFrame.data, eligibility, "alert", Date.now());
  }, [dayFrame.data, eligibility]);

  const armed = armedAccounts(accounts.data ?? []);
  const equityValue = Number(equity);
  const riskValue = Number(riskPercent);
  const lots = Number(maxLots);

  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4">
      <div>
        <h2 className="label-xs">Automatic trading</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          These are the same rules that decide your alerts. A setup your rules exclude produces no
          order at all.
        </p>
      </div>

      {accounts.isLoading ? (
        <p className="text-xs text-muted-foreground">Reading your connected accounts…</p>
      ) : accounts.isError ? (
        <p className="text-xs text-warning">
          Your connected accounts could not be read, so P-Trades makes no claim here about what is
          armed. The rules below still govern your feed and alerts.
        </p>
      ) : armed.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No account is armed for automatic orders, so these rules currently affect your feed and
          alerts only. Arming happens on the Broker accounts screen.
        </p>
      ) : (
        <p className="text-xs text-foreground">
          Armed:{" "}
          {armed
            .map(
              (a) =>
                `${a.label} (${a.broker.accountType === "real" ? "LIVE" : a.broker.accountType.toUpperCase()}, ${a.platform.toUpperCase()}, ${
                  a.mode === "demo_auto" ? "Demo auto" : "Live auto"
                })`,
            )
            .join(" · ")}
        </p>
      )}

      <div className="rounded-sm border border-border/60 bg-background/40 px-3 py-1">
        <Line label="Instruments">
          {instruments.length === 0
            ? "none selected — nothing is eligible"
            : instruments.map((i) => INSTRUMENT_LABELS[i] ?? i).join(", ")}
        </Line>
        <Line label="Grade">{GRADE_COPY[alertMinGrade] ?? alertMinGrade}</Line>
        <Line label="Sessions">
          {sessions.length === 0
            ? "none selected — nothing is eligible"
            : sessions.map((s) => SESSION_LABELS[s] ?? s).join(", ")}
        </Line>
        <Line label="Trades per day">
          {cap === 0 ? (
            "unlimited"
          ) : (
            <>
              {cap}
              {usedToday === null ? " (used today unavailable)" : ` (${usedToday} used today)`}
            </>
          )}
        </Line>
        <Line label="Risk per trade">
          {!Number.isFinite(riskValue) || riskValue <= 0
            ? "not set"
            : `${riskValue}%${
                Number.isFinite(equityValue) && equityValue > 0
                  ? ` of ${money(equityValue, currency)}`
                  : " — balance not set, so no size can be computed"
              }`}
        </Line>
        <Line label="Lot ceiling">
          {!Number.isFinite(lots) || lots <= 0 ? "no limit" : `${lots} lots`}
        </Line>
        <Line label="Broker leverage">
          {armed.length === 0
            ? "—"
            : armed
                .map((a) => (a.broker.leverage === null ? "not reported" : `1:${a.broker.leverage}`))
                .join(" · ")}
        </Line>
      </div>

      <p className="text-xs text-muted-foreground">
        Risk per trade and the lot ceiling size every automatic order. Every order is still
        re-checked immediately before it is sent — broker account type, connection health, symbol,
        fresh equity, margin and your account exposure boundary — and refused if any check fails.
      </p>
    </section>
  );
}
