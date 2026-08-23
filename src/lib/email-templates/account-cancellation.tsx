import * as React from "react";

import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

import type { TemplateEntry } from "./registry";
import { brandBar, container, footer, h1, hr, main, text } from "./brand";

interface AccountCancellationProps {
  restoreDeadline?: string;
}

const AccountCancellationEmail = ({ restoreDeadline }: AccountCancellationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your P-Trades Hub account is scheduled for deletion</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Account</Text>
        <Heading style={h1}>Your account is scheduled for deletion</Heading>
        <Text style={text}>
          We&apos;ve received your cancellation request. Your access has been closed and your
          account is scheduled for permanent deletion on{" "}
          <strong>{restoreDeadline ?? "the date shown in your settings"}</strong>.
        </Text>
        <Text style={text}>
          Changed your mind? Simply sign back in before that date and your account, scanner
          preferences and trade journal are restored in full. After that date everything is removed
          permanently and cannot be recovered.
        </Text>
        <Hr style={hr} />
        <Text style={footer}>
          If you did not request this, sign in now to reverse the cancellation.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: AccountCancellationEmail,
  subject: "Your P-Trades Hub account is scheduled for deletion",
  displayName: "Account cancellation",
  previewData: { restoreDeadline: "6 September 2026" },
} satisfies TemplateEntry;

export default AccountCancellationEmail;
