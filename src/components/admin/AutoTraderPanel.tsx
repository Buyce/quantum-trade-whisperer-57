/**
 * Broker-verified outcomes of the automatic trader (owner only).
 *
 * This panel reports only what the broker did: closed fills, broker-reported
 * money, and the grade each order carried. It is not the replay engine and not
 * user-reported. Zero closed trades renders a zero state — never a placeholder
 * number.
 *
 * Reporting rules the layout enforces on purpose:
 * - The blended per-grade row is NOT a grade comparison. Grades in this ledger
 *   did not trade the same instruments or the same directions, so the blended
 *   row is labelled as mix-dependent and money is labelled as not
 *   risk-comparable.
 * - Quality is read from R (risk-normalised), never from summed money across
 *   different instruments and lot sizes.
 * - Every average shows its own R sample and setup count, because the money
 *   column and the R column do not cover the same trades.
 * - The ladder block is the only place a grade ordering claim may be made, and
 *   it prints "not enough evidence" instead of a ranking below the floor.
 */
import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminAutoTraderOutcomes } from "@/lib/admin.functions";
import { PanelShell, num, pctOf } from "@/components/admin/AdminPanels";
import { Skeleton } from "@/components/ui/skeleton";
import type { AutoTraderBucket, AutoTraderCohortBucket } from "@/lib/admin/auto-trader-outcomes";
import type { GradePairComparison } from "@/lib/admin/grade-comparison";

function money(bucket: AutoTraderBucket): string {
  if (bucket.mixedCurrency) return "mixed currencies";
  if (bucket.netProfit === null) return "—";
  return `${bucket.netProfit > 0 ? "+" : ""}${num(bucket.netProfit, 2)}${
    bucket.currency ? ` ${bucket.currency}` : ""
  }`;
}

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}

function Row({
  bucket,
  label,
  emphasis,
  indent,
}: {
  bucket: AutoTraderBucket;
  label: string;
  emphasis?: boolean;
  indent?: boolean;
}) {
  return (
    <tr className={emphasis ? "border-b border-border font-semibold" : "border-b border-border/50"}>
      <td className={`py-1 pr-2 ${indent ? "pl-3 text-muted-foreground" : ""}`}>
        {label}
        {bucket.recoveredGrades > 0 ? (
          <span
            className="ml-1 text-muted-foreground"
            title={`${bucket.recoveredGrades} of these grades were proved from the enqueue decision log after the setup row was purged`}
          >
            *
          </span>
        ) : null}
      </td>
      <td className="py-1 pr-2 text-right">
        {bucket.meanR === null ? "—" : num(bucket.meanR)}
        <span className="ml-1 text-muted-foreground">
          (n={bucket.rSample}
          {bucket.rClusters !== bucket.rSample ? `, ${bucket.rClusters} setups` : ""})
        </span>
      </td>
      <td className="py-1 pr-2 text-right">{pctOf(bucket.winRate)}</td>
      <td className="py-1 pr-2 text-right text-muted-foreground">
        {bucket.wins}/{bucket.losses}
        {bucket.scratches > 0 ? `/${bucket.scratches}` : ""}
      </td>
      <td className="py-1 pr-2 text-right">
        {bucket.trades}
        {bucket.unmeasured > 0 ? (
          <span
            className="ml-1 text-muted-foreground"
            title={`${bucket.unmeasured} closed trade(s) carry no broker-reported money, so they are excluded from win rate`}
          >
            ({bucket.measured}m)
          </span>
        ) : null}
      </td>
      <td className="py-1 text-right font-mono text-muted-foreground">{money(bucket)}</td>
    </tr>
  );
}

function verdictText(pair: GradePairComparison): { text: string; tone: string } {
  const step = `${pair.higherGrade} vs ${pair.lowerGrade}`;
  if (pair.verdict === "insufficient_evidence") {
    return {
      text: `${step}: not enough like-for-like evidence yet (${pair.clustersHigher} vs ${pair.clustersLower} comparable setups across ${pair.strata.length} instrument/direction group(s)). No ordering claim is made.`,
      tone: "text-muted-foreground",
    };
  }
  const diff = `${pair.diffR! > 0 ? "+" : ""}${num(pair.diffR)}R`;
  const ci = `95% CI ${num(pair.ci95![0])} to ${num(pair.ci95![1])}`;
  if (pair.verdict === "no_separation") {
    return {
      text: `${step}: no separation. Like-for-like difference ${diff} (${ci}) — the interval spans zero, so these grades are not distinguishable on this evidence.`,
      tone: "text-muted-foreground",
    };
  }
  if (pair.verdict === "higher_grade_better") {
    return {
      text: `${step}: the higher grade is ahead by ${diff} (${ci}) on like-for-like setups.`,
      tone: "text-success",
    };
  }
  return {
    text: `${step}: the LOWER grade is ahead by ${num(-pair.diffR!)}R (${ci}) on like-for-like setups. That is a grading calibration finding, not a reason to trade C.`,
    tone: "text-warning",
  };
}

export function AutoTraderPanel() {
  const load = useServerFn(getAdminAutoTraderOutcomes);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-auto-trader-outcomes"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (isLoading) return <Skeleton className="h-32" />;

  const cohortsOf = (grade: string): AutoTraderCohortBucket[] =>
    (data?.byCohort ?? []).filter((c) => c.grade === grade);

  return (
    <PanelShell
      title="Auto trader — broker-verified outcomes"
      right={
        <span className="text-[11px] text-muted-foreground">
          {data ? `${data.total.trades} closed broker trades` : "unavailable"}
        </span>
      }
    >
      {isError || !data ? (
        <p className="text-[11px] text-warning">
          The broker evidence ledger could not be read, so no claim is made here about auto-trader
          outcomes.
        </p>
      ) : data.total.trades === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No automatic order has closed at the broker yet. That says nothing about the scanner or
          the dispatcher — only that there is no closed fill to measure.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Evidence scope:{" "}
            {data.evidence.accountTypes.length > 0
              ? data.evidence.accountTypes.join(" + ")
              : "account type unrecorded"}{" "}
            accounts, entries {day(data.evidence.from)} to {day(data.evidence.to)},{" "}
            {data.evidence.clusters} distinct setups behind {data.total.rSample} R values.{" "}
            {data.evidence.withoutR} closed trade(s) have broker money but no plan geometry, so they
            are outside every R figure.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[11px]">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border/60 text-left">
                  <th className="py-1 pr-2 font-medium">Grade / cohort</th>
                  <th className="py-1 pr-2 text-right font-medium">Mean R vs plan</th>
                  <th className="py-1 pr-2 text-right font-medium">Win rate</th>
                  <th className="py-1 pr-2 text-right font-medium">W/L</th>
                  <th className="py-1 pr-2 text-right font-medium">Trades</th>
                  <th className="py-1 text-right font-medium">Net money (not comparable)</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <Row bucket={data.total} label="All grades" emphasis />
                {data.byGrade.map((bucket) => (
                  <Fragment key={bucket.grade}>
                    <Row
                      bucket={bucket}
                      label={`${bucket.grade === "TOTAL" ? "All grades" : bucket.grade} (blended mix)`}
                    />
                    {cohortsOf(bucket.grade).map((cohort) => (
                      <Row
                        key={`${cohort.grade}-${cohort.symbol}-${cohort.direction}`}
                        bucket={cohort}
                        label={`${cohort.symbol} ${cohort.direction}`}
                        indent
                      />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1 rounded border border-border/60 p-2">
            <p className="text-[11px] font-semibold">Like-for-like grade ladder</p>
            {data.ladder.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">
                No two ladder grades share a comparable instrument/direction group yet.
              </p>
            ) : (
              data.ladder.map((pair) => {
                const v = verdictText(pair);
                return (
                  <p
                    key={`${pair.higherGrade}-${pair.lowerGrade}`}
                    className={`text-[10px] leading-relaxed ${v.tone}`}
                  >
                    {v.text}
                    {pair.excludedStrata.length > 0 ? (
                      <span className="text-muted-foreground">
                        {" "}
                        Excluded for too few setups on one side:{" "}
                        {pair.excludedStrata.map((s) => s.stratum).join(", ")}.
                      </span>
                    ) : null}
                  </p>
                );
              })
            )}
          </div>

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Read quality from mean R, never from the money column: lot sizes and instruments differ
            across cohorts, so summed money ranks position size, not setup quality. The blended
            per-grade row depends on which instruments and directions that grade happened to trade
            in this window and is not a grade comparison — only the ladder block above compares
            grades on matched instrument/direction groups with repeated fills of one setup collapsed
            to one observation. Win = broker net profit above zero (gross + swap + commission); an
            exactly flat trade is a scratch. Trades with no broker-reported money are shown in the
            trade count but excluded from win rate. * marks grades proved from the enqueue decision
            log after the setup row was purged — those trades have no plan geometry, so they carry
            no R.
          </p>
        </div>
      )}
    </PanelShell>
  );
}
