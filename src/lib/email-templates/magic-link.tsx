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

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ confirmationUrl }: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your P-Trades Hub login link</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Sign in</Text>
        <Heading style={h1}>Your login link</Heading>
        <Text style={text}>
          Click below to open your terminal. This single-use link expires
          shortly.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Open terminal
        </Button>
        <Hr style={hr} />
        <Text style={footer}>
          If you didn&apos;t request this link, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail
