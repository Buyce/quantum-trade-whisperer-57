import * as React from "react";

import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

import type { TemplateEntry } from "./registry";
import { MONO, brandBar, container, footer, h1, hr, main, text } from "./brand";

interface AccountCancellationAdminProps {
  userEmail?: string;
  userId?: string;
  requestedAt?: string;
  scheduledFor?: string;
}

const mono = { ...text, fontFamily: MONO, fontSize: "13px", margin: "0 0 8px" };

const AccountCancellationAdminEmail = ({
  userEmail,
  userId,
  requestedAt,
  scheduledFor,
}: AccountCancellationAdminProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>A trader cancelled their P-Trades Hub account</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Admin notice</Text>
        <Heading style={h1}>Account cancellation</Heading>
        <Text style={mono}>user: {userEmail ?? "unknown"}</Text>
        <Text style={mono}>id: {userId ?? "unknown"}</Text>
        <Text style={mono}>requested: {requestedAt ?? "unknown"}</Text>
        <Text style={mono}>permanent deletion: {scheduledFor ?? "unknown"}</Text>
        <Hr style={hr} />
        <Text style={footer}>
          The account stays restorable until the deletion date — signing back in reverses it
          automatically.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: AccountCancellationAdminEmail,
  subject: "P-Trades Hub — account cancellation",
  displayName: "Account cancellation (admin)",
  to: "boatengampomah@gmail.com",
  previewData: {
    userEmail: "trader@example.com",
    userId: "00000000-0000-0000-0000-000000000000",
    requestedAt: "7 August 2026",
    scheduledFor: "6 September 2026",
  },
} satisfies TemplateEntry;

export default AccountCancellationAdminEmail;
