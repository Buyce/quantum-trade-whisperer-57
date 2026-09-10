import * as React from "react";

import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

import type { TemplateEntry } from "./registry";
import { MONO, brandBar, container, footer, h1, hr, main, text } from "./brand";

interface StageChangeRow {
  instrument?: string;
  from?: string;
  to?: string;
  action?: string;
  reasons?: string[];
}

interface InstrumentStageChangedProps {
  changes?: StageChangeRow[];
  ranAt?: string;
}

const mono = { ...text, fontFamily: MONO, fontSize: "13px", margin: "0 0 8px" };

const InstrumentStageChangedEmail = ({ changes = [], ranAt }: InstrumentStageChangedProps) => {
  const demoted = changes.filter((c) => c.action === "demote");
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {demoted.length > 0
          ? "An instrument was moved back a stage automatically"
          : "An instrument moved forward a stage automatically"}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={brandBar}>P-Trades Hub · Instrument lifecycle</Text>
          <Heading style={h1}>Instrument stage changed automatically</Heading>
          <Text style={text}>
            The daily lifecycle check found that the recorded evidence for the instruments below
            either cleared every gate for the next stage, or fell below the standard required to
            stay where they were. Each change was written to the audited transition log.
          </Text>
          <Hr style={hr} />
          {changes.map((change, index) => (
            <React.Fragment key={`${change.instrument ?? "unknown"}-${index}`}>
              <Text style={mono}>
                {change.action === "demote" ? "moved back" : "moved forward"}:{" "}
                {change.instrument ?? "unknown"} {change.from ?? "unknown"} →{" "}
                {change.to ?? "unknown"}
              </Text>
              {(change.reasons ?? []).slice(0, 4).map((reason, i) => (
                <Text key={i} style={mono}>
                  · {reason}
                </Text>
              ))}
            </React.Fragment>
          ))}
          <Hr style={hr} />
          <Text style={mono}>checked: {ranAt ?? "unknown"}</Text>
          <Text style={footer}>
            Reaching the final stage only means the lifecycle no longer blocks execution for this
            instrument. The global execution switch, each account&apos;s own settings, the risk
            brakes and the intelligence gate all still apply, and none of them were changed. Every
            figure behind these decisions is real recorded evidence — no estimates.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: InstrumentStageChangedEmail,
  subject: "P-Trades Hub — instrument stage changed automatically",
  displayName: "Instrument stage changed (admin)",
  to: "boatengampomah@gmail.com",
  previewData: {
    ranAt: "10 September 2026 05:10 UTC",
    changes: [
      {
        instrument: "USDJPY",
        from: "data_validation",
        to: "shadow",
        action: "promote",
        reasons: [],
      },
    ],
  },
} satisfies TemplateEntry;

export default InstrumentStageChangedEmail;
