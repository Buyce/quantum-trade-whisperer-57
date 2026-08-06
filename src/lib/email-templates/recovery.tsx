import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from '@react-email/components'

import { brandBar, button, container, footer, h1, hr, main, text } from './brand'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ confirmationUrl }: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your P-Trades Hub password</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Account security</Text>
        <Heading style={h1}>Reset your password</Heading>
        <Text style={text}>
          We received a request to reset the password on your P-Trades Hub
          account. Choose a new one below — the link expires shortly.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Reset password
        </Button>
        <Hr style={hr} />
        <Text style={footer}>
          If you didn&apos;t request this, ignore this email — your password
          stays unchanged.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail
