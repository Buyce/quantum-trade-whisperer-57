import * as React from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Text,
} from "@react-email/components";

import { brandBar, button, container, footer, h1, hr, link, main, text } from "./brand";

interface SignupEmailProps {
  siteName: string;
  siteUrl: string;
  recipient: string;
  confirmationUrl: string;
}

export const SignupEmail = ({ siteUrl, recipient, confirmationUrl }: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email to activate your P-Trades Hub terminal</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Market Scanner</Text>
        <Heading style={h1}>Confirm your email</Heading>
        <Text style={text}>
          Thanks for signing up for{" "}
          <Link href={siteUrl} style={link}>
            <strong>P-Trades Hub</strong>
          </Link>
          . Confirm{" "}
          <Link href={`mailto:${recipient}`} style={link}>
            {recipient}
          </Link>{" "}
          to unlock the signal feed, trade profiles and performance analytics.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Verify email
        </Button>
        <Hr style={hr} />
        <Text style={footer}>
          If you didn&apos;t create an account, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
);

export default SignupEmail;
