import * as React from "react";

import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

import type { TemplateEntry } from "./registry";
import { MONO, brandBar, container, footer, h1, hr, main, text } from "./brand";

interface TierBlock {
  label?: string;
  enrolled?: number;
  resolved?: number;
  pendingResolution?: number;
  filled?: number;
  wins?: number;
  losses?: number;
  neverFilled?: number;
  expired?: number;
  fillRate?: string;
  winRate?: string;
  meanR?: string;
  totalR?: string;
  expectancyR?: string;
  medianMissAtr?: string;
  /** Which R denominator every R figure in this block uses. */
  rBasis?: string;
}

interface ComparisonBlock {
  label?: string;
  highRate?: string;
  lowRate?: string;
  highN?: number;
  lowN?: number;
  highClusters?: number;
  lowClusters?: number;
  difference?: string;
  /** Primary dependence-aware interval. */
  intervalStatus?: string;
  interval?: string;
  intervalMethod?: string;
  intervalSeed?: number;
  intervalRunId?: string;
  intervalReason?: string;
  /** Secondary, independence-assuming diagnostics only. */
  z?: string;
  pValue?: string;
  verdict?: string;
  evidenceLevel?: string;
  blockers?: string[];
  note?: string;
}

interface WeeklyShadowReportProps {
  isoWeek?: string;
  windowStart?: string;
  windowEnd?: string;
  totalResolved?: number;
  immature?: number;
  maturityHours?: number;
  high?: TierBlock;
  low?: TierBlock;
  comparisons?: ComparisonBlock[];
}

const mono = { ...text, fontFamily: MONO, fontSize: "13px", margin: "0 0 6px" };
const subhead = { ...text, fontWeight: 700, margin: "0 0 8px" };
const caption = { ...text, fontSize: "12px", margin: "0 0 10px" };

const Tier = ({ tier }: { tier: TierBlock }) => (
  <>
    <Text style={subhead}>{tier.label ?? "tier"}</Text>
    <Text style={mono}>raw n (enrolled): {tier.enrolled ?? 0}</Text>
    <Text style={mono}>raw n (resolved): {tier.resolved ?? 0}</Text>
    <Text style={mono}>
      mature but unresolved (pending_resolution): {tier.pendingResolution ?? 0}
    </Text>
    <Text style={mono}>filled: {tier.filled ?? 0}</Text>
    <Text style={mono}>
      wins / losses: {tier.wins ?? 0} / {tier.losses ?? 0}
    </Text>
    <Text style={mono}>
      never filled / expired: {tier.neverFilled ?? 0} / {tier.expired ?? 0}
    </Text>
    <Text style={mono}>fill rate: {tier.fillRate ?? "n/a"}</Text>
    <Text style={mono}>win rate (of filled): {tier.winRate ?? "n/a"}</Text>
    <Text style={mono}>R basis: {tier.rBasis ?? "replay realized R (per-plan risk)"}</Text>
    <Text style={mono}>
      mean R [{tier.rBasis ?? "replay realized R (per-plan risk)"}]: {tier.meanR ?? "n/a"}
    </Text>
    <Text style={mono}>
      total R [{tier.rBasis ?? "replay realized R (per-plan risk)"}]: {tier.totalR ?? "n/a"}
    </Text>
    <Text style={mono}>
      expectancy [{tier.rBasis ?? "replay realized R (per-plan risk)"}]: {tier.expectancyR ?? "n/a"}
    </Text>
    <Text style={mono}>median miss distance (unfilled): {tier.medianMissAtr ?? "n/a"}</Text>
  </>
);

const WeeklyShadowReportEmail = ({
  isoWeek,
  windowStart,
  windowEnd,
  totalResolved,
  immature,
  maturityHours,
  high = {},
  low = {},
  comparisons = [],
}: WeeklyShadowReportProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`Weekly shadow report ${isoWeek ?? ""} — A/A+ vs B/C, ${totalResolved ?? 0} resolved setups`}</Preview>

    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Shadow telemetry</Text>
        <Heading style={h1}>Weekly shadow report — {isoWeek ?? "this week"}</Heading>
        <Text style={text}>
          Forward-test results from the shadow engine for {windowStart ?? "?"} to {windowEnd ?? "?"}{" "}
          (UTC), split into the high tier (A, A+) and the low tier (B, C). Every number below is an
          aggregate over live replayed setups — {totalResolved ?? 0} resolved in the window.
        </Text>
        <Text style={caption}>
          Maturity horizon: {maturityHours ?? 24}h. Observations detected inside that horizon are
          right-censored and excluded from every rate: {immature ?? 0} censored this window.
        </Text>

        <Hr style={hr} />
        <Tier tier={high} />
        <Hr style={hr} />
        <Tier tier={low} />
        <Hr style={hr} />

        <Text style={subhead}>
          Tier comparison — dependence-aware whole-UTC-day cluster bootstrap
        </Text>
        <Text style={caption}>
          The primary interval resamples whole UTC detected days, so setups that share a day stay
          together. Below the independent-day floor no interval is reported and the evidence level
          is "insufficient".
        </Text>
        {comparisons.length === 0 ? (
          <Text style={mono}>no comparisons available</Text>
        ) : (
          comparisons.map((c, i) => (
            <React.Fragment key={i}>
              <Text style={{ ...mono, marginTop: "10px", fontWeight: 700 }}>
                {c.label ?? "comparison"}
              </Text>
              <Text style={mono}>
                A/A+ {c.highRate ?? "n/a"} (raw n={c.highN ?? 0}, independent UTC days=
                {c.highClusters ?? 0}) vs B/C {c.lowRate ?? "n/a"} (raw n={c.lowN ?? 0}, independent
                UTC days={c.lowClusters ?? 0})
              </Text>
              <Text style={mono}>point difference: {c.difference ?? "n/a"}</Text>
              <Text style={mono}>
                dependence-aware 95% interval: {c.interval ?? "not reported"} (status:{" "}
                {c.intervalStatus ?? "n/a"})
              </Text>
              {c.intervalReason ? <Text style={mono}>why: {c.intervalReason}</Text> : null}
              <Text style={mono}>
                method: {c.intervalMethod ?? "n/a"} · seed: {c.intervalSeed ?? "n/a"} · run:{" "}
                {c.intervalRunId ?? "n/a"}
              </Text>
              <Text style={mono}>evidence level: {c.evidenceLevel ?? "n/a"}</Text>
              {(c.blockers ?? []).length > 0 ? (
                <Text style={mono}>blockers: {(c.blockers ?? []).join(" ")}</Text>
              ) : null}
              <Text style={mono}>
                verdict: {c.verdict ?? "n/a"} — {c.note ?? ""}
              </Text>
              <Text style={mono}>
                diagnostics assuming independence (NOT a verdict input) — z: {c.z ?? "n/a"} · p:{" "}
                {c.pValue ?? "n/a"}
              </Text>
            </React.Fragment>
          ))
        )}

        <Hr style={hr} />
        <Text style={footer}>
          Verdicts come from the shared evidence gate: raw sample floor, independent UTC-day floor,
          and a dependence-aware interval that excludes zero. z and p assume independent
          observations, which intraday setups violate, so they are printed as diagnostics only and
          never earn the word "significant". These statistics are observational — grading, alerting
          and the daily setup limit do not read them. Sent once per ISO week.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: WeeklyShadowReportEmail,
  subject: (data: Record<string, unknown>) =>
    `P-Trades Hub — weekly shadow report ${data["isoWeek"] ?? ""} (A/A+ vs B/C)`,
  displayName: "Weekly shadow report (admin)",
  to: "boatengampomah@gmail.com",
  previewData: {
    isoWeek: "2026-W34",
    windowStart: "2026-08-12",
    windowEnd: "2026-08-19",
    totalResolved: 41,
    immature: 3,
    maturityHours: 24,
    high: {
      label: "A / A+",
      enrolled: 6,
      resolved: 5,
      pendingResolution: 1,
      filled: 3,
      wins: 2,
      losses: 1,
      neverFilled: 2,
      expired: 0,
      fillRate: "60.0%",
      winRate: "66.7%",
      rBasis: "replay realized R (per-plan risk)",
      meanR: "0.84R",
      totalR: "2.51R",
      expectancyR: "0.84R",
      medianMissAtr: "0.91 ATR",
    },
    low: {
      label: "B / C",
      enrolled: 44,
      resolved: 36,
      pendingResolution: 8,
      filled: 16,
      wins: 6,
      losses: 10,
      neverFilled: 18,
      expired: 2,
      fillRate: "44.4%",
      winRate: "37.5%",
      rBasis: "replay realized R (per-plan risk)",
      meanR: "-0.09R",
      totalR: "-1.44R",
      expectancyR: "-0.09R",
      medianMissAtr: "1.12 ATR",
    },
    comparisons: [
      {
        label: "Fill rate (filled / resolved)",
        highRate: "60.0%",
        lowRate: "44.4%",
        highN: 5,
        lowN: 36,
        highClusters: 3,
        lowClusters: 12,
        difference: "15.6 pts",
        intervalStatus: "insufficient_clusters",
        interval: "not reported",
        intervalReason:
          "Only 3 vs 12 independent trading day(s); 10 required per group before a dependence-aware interval is reported.",
        intervalMethod: "whole_utc_day_cluster_bootstrap",
        intervalSeed: 20260821,
        intervalRunId: "whole_utc_day_cluster_bootstrap:diff:v1:seed20260821:B2000",
        z: "n/a",
        pValue: "n/a",
        verdict: "insufficient",
        evidenceLevel: "insufficient",
        blockers: ["Fewer than 10 independent trading days in one group."],
        note: "No conclusion drawn.",
      },
    ],
  },
} satisfies TemplateEntry;

export default WeeklyShadowReportEmail;
