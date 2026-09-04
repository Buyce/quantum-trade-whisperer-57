import * as React from "react";

import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

import type { TemplateEntry } from "./registry";
import { MONO, brandBar, container, footer, h1, hr, main, text } from "./brand";

interface GateChangeAppliedProps {
  /** 'applied' = the system changed a threshold. 'reverted' = it undid one. */
  action?: "applied" | "reverted";
  gate?: string;
  verdict?: string | null;
  newValue?: number | null;
  previousValue?: number | null;
  postChangeMeanR?: number | null;
  preChangeMeanR?: number | null;
  tradingDays?: number;
  decidedAt?: string;
}

const mono = { ...text, fontFamily: MONO, fontSize: "13px", margin: "0 0 8px" };

const r = (v?: number | null) => (typeof v === "number" ? `${v.toFixed(2)}R` : "unknown");

const GateChangeAppliedEmail = ({
  action = "applied",
  gate,
  verdict,
  newValue,
  previousValue,
  postChangeMeanR,
  preChangeMeanR,
  tradingDays,
  decidedAt,
}: GateChangeAppliedProps) => {
  const reverted = action === "reverted";
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {reverted
          ? "An automatic threshold change was undone"
          : "A signal-quality threshold was changed automatically"}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={brandBar}>P-Trades Hub · Learning engine</Text>
          <Heading style={h1}>
            {reverted ? "Automatic change undone" : "Threshold changed automatically"}
          </Heading>
          <Text style={text}>
            {reverted
              ? "The follow-up cohort detected after an automatic threshold change performed worse than the population it replaced, so the change was undone and the previous value restored."
              : "The evidence cleared the full training bar and your automatic-application switch is on, so the system changed this threshold and recorded the decision in the audit log."}
          </Text>
          <Hr style={hr} />
          <Text style={mono}>threshold: {gate ?? "unknown"}</Text>
          <Text style={mono}>
            value: {previousValue ?? "default"} → {newValue ?? "default"}
          </Text>
          <Text style={mono}>verdict on the evidence: {verdict ?? "unknown"}</Text>
          {reverted && (
            <>
              <Text style={mono}>post-change published arm: {r(postChangeMeanR)}</Text>
              <Text style={mono}>pre-change published arm: {r(preChangeMeanR)}</Text>
            </>
          )}
          <Text style={mono}>trading days of research outcomes: {tradingDays ?? "unknown"}</Text>
          <Text style={mono}>evidence frozen: {decidedAt ?? "unknown"}</Text>
          <Hr style={hr} />
          <Text style={footer}>
            All figures are replay-derived research outcomes from real candles, never broker money
            P/L. You can review, revert, or turn automatic application off at any time in Admin →
            Intelligence.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: GateChangeAppliedEmail,
  subject: (data: Record<string, unknown>) =>
    data["action"] === "reverted"
      ? "P-Trades Hub — automatic threshold change undone"
      : "P-Trades Hub — signal-quality threshold changed automatically",
  displayName: "Gate change applied (admin)",
  to: "boatengampomah@gmail.com",
  previewData: {
    action: "applied",
    gate: "risk_ceiling",
    verdict: "loosening_supported",
    newValue: 3.3,
    previousValue: 3,
    tradingDays: 21,
    decidedAt: "4 September 2026 07:00 UTC",
  },
} satisfies TemplateEntry;

export default GateChangeAppliedEmail;
