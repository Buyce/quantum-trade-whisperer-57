import * as React from "react";

import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

import type { TemplateEntry } from "./registry";
import { MONO, brandBar, container, footer, h1, hr, main, text } from "./brand";

interface LearningMilestoneProps {
  /** 'fill' = 150 resolved samples reached. 'win' = 200 filled samples reached. */
  gate?: "fill" | "win";
  threshold?: number;
  resolvedSamples?: number;
  filledSamples?: number;
  wins?: number;
  globalPFill?: number;
  globalPWin?: number;
  reachedAt?: string;
}

const mono = { ...text, fontFamily: MONO, fontSize: "13px", margin: "0 0 8px" };

const pct = (v?: number) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "unknown");

const LearningMilestoneEmail = ({
  gate = "fill",
  threshold,
  resolvedSamples,
  filledSamples,
  wins,
  globalPFill,
  globalPWin,
  reachedAt,
}: LearningMilestoneProps) => {
  const isFill = gate === "fill";
  const headline = isFill ? "Fill-rate gate cleared" : "Win-rate gate cleared";
  const explanation = isFill
    ? "The shadow telemetry engine has now resolved enough setups for the fill-rate side of the Intelligence Panel to be statistically meaningful. Those figures are no longer labelled advisory."
    : "Enough shadow setups have actually filled for the win-if-filled side of the Intelligence Panel to be statistically meaningful.";

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{headline} — the Intelligence Panel is learning</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={brandBar}>P-Trades Hub · Learning engine</Text>
          <Heading style={h1}>{headline}</Heading>
          <Text style={text}>{explanation}</Text>
          <Hr style={hr} />
          <Text style={mono}>
            threshold: {threshold ?? "unknown"} {isFill ? "resolved" : "filled"} samples
          </Text>
          <Text style={mono}>resolved samples: {resolvedSamples ?? "unknown"}</Text>
          <Text style={mono}>filled samples: {filledSamples ?? "unknown"}</Text>
          <Text style={mono}>wins: {wins ?? "unknown"}</Text>
          <Text style={mono}>global fill rate: {pct(globalPFill)}</Text>
          <Text style={mono}>global win-if-filled: {pct(globalPWin)}</Text>
          <Text style={mono}>reached: {reachedAt ?? "unknown"}</Text>
          <Hr style={hr} />
          <Text style={footer}>
            These statistics remain observational: grading, alerting and the daily setup limit do
            not read them. Clearing a gate only changes how the numbers are labelled in the app.
            Sent once per threshold.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: LearningMilestoneEmail,
  subject: (data: Record<string, any>) =>
    data["gate"] === "win"
      ? "P-Trades Hub — win-rate gate cleared (200 filled samples)"
      : "P-Trades Hub — fill-rate gate cleared (150 resolved samples)",
  displayName: "Learning milestone (admin)",
  to: "boatengampomah@gmail.com",
  previewData: {
    gate: "fill",
    threshold: 150,
    resolvedSamples: 151,
    filledSamples: 44,
    wins: 17,
    globalPFill: 0.2914,
    globalPWin: 0.3864,
    reachedAt: "18 August 2026 11:00 UTC",
  },
} satisfies TemplateEntry;

export default LearningMilestoneEmail;
