import * as React from "react";

import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

import type { TemplateEntry } from "./registry";
import { MONO, brandBar, container, footer, h1, hr, main, text } from "./brand";

interface ReadyGate {
  gate?: string;
  verdict?: string | null;
  currentValue?: number | null;
  passN?: number | null;
  failN?: number | null;
  passMeanR?: number | null;
  failMeanR?: number | null;
}

interface ModelReadinessProps {
  tradingDays?: number;
  minTradingDays?: number;
  minSamplesPerArm?: number;
  minClustersPerArm?: number;
  autoApplyEnabled?: boolean;
  gates?: ReadyGate[];
  reachedAt?: string;
}

const mono = { ...text, fontFamily: MONO, fontSize: "13px", margin: "0 0 8px" };

const r = (v?: number | null) => (typeof v === "number" ? `${v.toFixed(2)}R` : "unknown");

const ModelReadinessEmail = ({
  tradingDays,
  minTradingDays,
  minSamplesPerArm,
  minClustersPerArm,
  autoApplyEnabled = false,
  gates = [],
  reachedAt,
}: ModelReadinessProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>The learning dataset is large enough to build the model</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Learning engine</Text>
        <Heading style={h1}>The learning dataset is ready</Heading>
        <Text style={text}>
          Enough matured research outcomes have accumulated for at least one signal-quality
          threshold to be decided from evidence rather than judgement. Every figure below is
          replay-derived from real candles — none of it is broker money P/L.
        </Text>
        <Hr style={hr} />
        <Text style={mono}>
          bar: {minSamplesPerArm ?? "unknown"} matured samples and {minClustersPerArm ?? "unknown"}{" "}
          independent clusters per arm, over {minTradingDays ?? "unknown"} trading days
        </Text>
        <Text style={mono}>trading days of research outcomes: {tradingDays ?? "unknown"}</Text>
        <Text style={mono}>frozen as of: {reachedAt ?? "unknown"}</Text>
        <Hr style={hr} />
        {gates.length === 0 ? (
          <Text style={mono}>no threshold cleared the bar</Text>
        ) : (
          gates.map((g) => (
            <Text key={g.gate ?? Math.random()} style={mono}>
              {g.gate ?? "unknown"} (now {g.currentValue ?? "default"}): {g.verdict ?? "no verdict"}{" "}
              · published {r(g.passMeanR)} on n={g.passN ?? 0} vs rejected {r(g.failMeanR)} on n=
              {g.failN ?? 0}
            </Text>
          ))
        )}
        <Hr style={hr} />
        <Text style={footer}>
          {autoApplyEnabled
            ? "Automatic application is ON: the system may now apply a threshold change that clears this bar, and will undo it automatically if the follow-up cohort comes out worse. Every change is written to the audit log."
            : "Automatic application is OFF: the system will open a proposal in Admin → Intelligence, but nothing changes until you approve it."}{" "}
          Sent once.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: ModelReadinessEmail,
  subject: "P-Trades Hub — the learning dataset is ready to build the model",
  displayName: "Model readiness (admin)",
  to: "boatengampomah@gmail.com",
  previewData: {
    tradingDays: 21,
    minTradingDays: 20,
    minSamplesPerArm: 200,
    minClustersPerArm: 10,
    autoApplyEnabled: false,
    gates: [
      {
        gate: "risk_ceiling",
        verdict: "loosening_supported",
        currentValue: 3,
        passN: 412,
        failN: 268,
        passMeanR: 0.11,
        failMeanR: 0.34,
      },
    ],
    reachedAt: "4 September 2026 07:00 UTC",
  },
} satisfies TemplateEntry;

export default ModelReadinessEmail;
