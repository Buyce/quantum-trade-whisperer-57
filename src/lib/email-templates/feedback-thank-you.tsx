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
import { BRAND_BORDER, brandBar, container, footer, h1, hr, main, text } from "./brand";

interface FeedbackThankYouProps {
  category?: string;
  message?: string;
}

const quote = {
  border: `1px solid ${BRAND_BORDER}`,
  borderRadius: "6px",
  padding: "14px 16px",
  margin: "0 0 22px",
};

const FeedbackThankYouEmail = ({ category, message }: FeedbackThankYouProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Thanks for your P-Trades Hub feedback</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Feedback</Text>
        <Heading style={h1}>Thank you for your feedback</Heading>
        <Text style={text}>
          Your {category ? category.toLowerCase() : ""} feedback reached us and it&apos;s already on
          the desk. Every report is read by a human — the ones that sharpen the scanner or the
          terminal get actioned first.
        </Text>
        {message ? (
          <Section style={quote}>
            <Text style={{ ...text, margin: 0, whiteSpace: "pre-wrap" }}>{message}</Text>
          </Section>
        ) : null}
        <Text style={text}>
          No action is needed from you. If we need more detail, we&apos;ll reply to this address.
        </Text>
        <Hr style={hr} />
        <Text style={footer}>Sent because you submitted feedback inside P-Trades Hub.</Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: FeedbackThankYouEmail,
  subject: "Thank you for your feedback — P-Trades Hub",
  displayName: "Feedback thank you",
  previewData: {
    category: "Feature request",
    message: "Add a session filter to the performance heat map.",
  },
} satisfies TemplateEntry;

export default FeedbackThankYouEmail;
