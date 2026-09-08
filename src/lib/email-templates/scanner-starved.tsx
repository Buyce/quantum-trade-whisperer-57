import * as React from "react";

import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

import type { TemplateEntry } from "./registry";
import { MONO, brandBar, container, footer, h1, hr, main, text } from "./brand";

interface ScannerStarvedProps {
  /** Jobs closed without any candle fetch because they aged past the freshness limit. */
  stale?: number;
  /** Jobs that actually ran the strategy on fetched candles. */
  analysed?: number;
  windowMinutes?: number;
  lastAnalysedAt?: string;
  lastCandleFetchAt?: string;
  linkOk?: number;
  linkFailed?: number;
  linkDetail?: string;
  openedAt?: string;
}

const mono = { ...text, fontFamily: MONO, fontSize: "13px", margin: "0 0 8px" };

const ScannerStarvedEmail = ({
  stale,
  analysed,
  windowMinutes,
  lastAnalysedAt,
  lastCandleFetchAt,
  linkOk,
  linkFailed,
  linkDetail,
  openedAt,
}: ScannerStarvedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Scanner is discarding work before analysing candles</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Scanner health</Text>
        <Heading style={h1}>Scanner not analysing</Heading>
        <Text style={text}>
          Scan jobs are being closed without any candle read because they waited past their
          freshness limit. The queue therefore looks like it is completing work while the strategy
          is not being run on the market at all, so no setups can be published. This is a queue
          throughput fault, not an absence of setups.
        </Text>
        <Hr style={hr} />
        <Text style={mono}>window: last {windowMinutes ?? "unknown"} minutes</Text>
        <Text style={mono}>discarded before any candle fetch: {stale ?? "unknown"}</Text>
        <Text style={mono}>actually analysed: {analysed ?? "unknown"}</Text>
        <Text style={mono}>last analysed job: {lastAnalysedAt ?? "unknown"}</Text>
        <Text style={mono}>last candle read: {lastCandleFetchAt ?? "unknown"}</Text>
        <Text style={mono}>
          database to app calls: {linkOk ?? "unknown"} ok / {linkFailed ?? "unknown"} failed
        </Text>
        <Text style={mono}>latest failed call: {linkDetail ?? "no detail recorded"}</Text>
        <Text style={mono}>incident opened: {openedAt ?? "unknown"}</Text>
        <Hr style={hr} />
        <Text style={footer}>
          Sent once per incident. Admin -&gt; Intelligence -&gt; Engine status shows the same
          measured figures live, and the incident closes automatically as soon as real candle
          analysis resumes.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: ScannerStarvedEmail,
  subject: "P-Trades Hub — scanner not analysing (work discarded before candle fetch)",
  displayName: "Scanner starvation (admin)",
  to: "boatengampomah@gmail.com",
  previewData: {
    stale: 36,
    analysed: 0,
    windowMinutes: 60,
    lastAnalysedAt: "2026-09-08 00:02 UTC",
    lastCandleFetchAt: "2026-09-08 00:16 UTC",
    linkOk: 105,
    linkFailed: 49,
    linkDetail: "timeout after 20000 ms",
    openedAt: "2026-09-08 07:15 UTC",
  },
} satisfies TemplateEntry;

export default ScannerStarvedEmail;
