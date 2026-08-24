import * as React from "react";

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

import type { TemplateEntry } from "./registry";
import { BRAND_BORDER, MONO, brandBar, container, footer, h1, hr, main, text } from "./brand";

interface FeedbackReceivedProps {
  category?: string;
  message?: string;
  reporterEmail?: string;
  userId?: string;
  submittedAt?: string;
}

const meta = { ...text, fontFamily: MONO, fontSize: "13px", margin: "0 0 8px" };

const quote = {
  border: `1px solid ${BRAND_BORDER}`,
  borderRadius: "6px",
  padding: "14px 16px",
  margin: "0 0 22px",
};

const FeedbackReceivedEmail = ({
  category,
  message,
  reporterEmail,
  userId,
  submittedAt,
}: FeedbackReceivedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>New P-Trades Hub feedback submission</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Feedback</Text>
        <Heading style={h1}>New feedback: {category ?? "other"}</Heading>
        <Text style={meta}>from: {reporterEmail ?? "not provided"}</Text>
        <Text style={meta}>user id: {userId ?? "unknown"}</Text>
        <Text style={meta}>submitted: {submittedAt ?? "unknown"}</Text>
        <Section style={quote}>
          <Text style={{ ...text, margin: 0, whiteSpace: "pre-wrap" }}>{message ?? ""}</Text>
        </Section>
        <Hr style={hr} />
        <Text style={footer}>Reply directly to the sender address above to follow up.</Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: FeedbackReceivedEmail,
  subject: (data: Record<string, unknown>) =>
    `P-Trades Hub feedback — ${data["category"] ?? "other"}`,
  displayName: "Feedback received (admin)",
  to: "boatengampomah@gmail.com",
  previewData: {
    category: "Bug",
    message: "The XAUUSD heartbeat stalls after a failed scan.",
    reporterEmail: "trader@example.com",
    userId: "00000000-0000-0000-0000-000000000000",
    submittedAt: "7 August 2026 04:20 UTC",
  },
} satisfies TemplateEntry;

export default FeedbackReceivedEmail;
