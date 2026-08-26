/**
 * Promotion checkpoint (owner only).
 *
 * One row per registry instrument: promotable or blocked, with every unmet
 * criterion named beside the value actually measured. It renders evidence, not a
 * recommendation, and it cannot promote anything — promotion stays the audited
 * lifecycle transition.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminPromotionCheckpoint } from "@/lib/admin.functions";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelShell } from "@/components/admin/AdminPanels";
import {
  MAX_MISSINGNESS_PCT,
  REQUIRED_TRADING_DAYS,
  REQUIRED_VALID_SAMPLES,
} from "@/lib/instruments/promotion";

export function PromotionPanel() {
  const load = useServerFn(getAdminPromotionCheckpoint);
  const query = useQuery({
    queryKey: ["admin-promotion-checkpoint"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (query.isLoading) return <Skeleton className="h-40" />;

  if (query.isError || !query.data) {
    return (
      <PanelShell title="Promotion checkpoint">
        <p className="text-[11px] text-warning">
          The promotion evidence could not be read, so nothing is claimed here about whether any
          instrument is ready to be measured.
        </p>
      </PanelShell>
    );
  }

  const { verdicts, windowDays, warnings } = query.data;

  return (
    <PanelShell title="Promotion checkpoint — data validation to shadow">
      <p className="text-[11px] text-muted-foreground">
        Evidence window: last {windowDays} days. Gate: {REQUIRED_TRADING_DAYS} distinct trading
        days, {REQUIRED_VALID_SAMPLES} valid samples, every session covered, missingness at or below{" "}
        {MAX_MISSINGNESS_PCT}%, a current passing readiness snapshot with route and live conversion
        proven, a stable verified provider symbol and a derived spread floor. Promotion is never
        automatic.
      </p>

      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-warning">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 space-y-2">
        {verdicts.map((v) => (
          <div key={v.instrument} className="rounded-md border border-border p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs">{v.instrument}</span>
              <span
                className={`text-[11px] ${v.promotable ? "text-success" : "text-muted-foreground"}`}
              >
                {v.promotable ? "promotable" : "blocked"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              stage {v.evidence.stage ?? "unreadable"} · {v.evidence.tradingDays} day(s) ·{" "}
              {v.evidence.validSamples} valid / {v.evidence.invalidSamples} rejected ·{" "}
              {v.evidence.missingnessPct === null
                ? "missingness —"
                : `missingness ${v.evidence.missingnessPct.toFixed(1)}%`}{" "}
              · sessions {v.evidence.coveredSessions.length}/{v.evidence.expectedSessions.length}
            </p>
            {v.reasons.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-warning">
                {v.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </PanelShell>
  );
}
