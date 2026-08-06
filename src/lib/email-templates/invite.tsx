import * as React from 'react'

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
} from '@react-email/components'

import {
  brandBar,
  button,
  container,
  footer,
  h1,
  hr,
  link,
  main,
  text,
} from './brand'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ siteUrl, confirmationUrl }: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You&apos;ve been invited to P-Trades Hub</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Invitation</Text>
        <Heading style={h1}>You&apos;ve been invited</Heading>
        <Text style={text}>
          You&apos;ve been invited to join{' '}
          <Link href={siteUrl} style={link}>
            <strong>P-Trades Hub</strong>
          </Link>
          , the autonomous forex scanner and trade assistant. Accept below to
          create your account.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Accept invitation
        </Button>
        <Hr style={hr} />
        <Text style={footer}>
          If you weren&apos;t expecting this invitation, you can safely ignore
          this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail
