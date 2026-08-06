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
  Section,
  Text,
} from '@react-email/components'

import type { TemplateEntry } from './registry'
import {
  BRAND_AMBER,
  BRAND_BORDER,
  BRAND_INK,
  MONO,
  brandBar,
  button,
  container,
  footer,
  h1,
  hr,
  main,
  text,
} from './brand'

interface SignalAlertProps {
  instrument?: string
  grade?: string
  direction?: string
  entryPrice?: string
  stopLoss?: string
  tp1?: string
  tp2?: string
  tp3?: string
  rrRatio?: string
  confidence?: string
  breakdown?: string
  feedUrl?: string
}

const row = {
  fontFamily: MONO,
  fontSize: '13px',
  color: BRAND_INK,
  margin: '0 0 6px',
}

const panel = {
  border: `1px solid ${BRAND_BORDER}`,
  borderRadius: '6px',
  padding: '16px 18px',
  margin: '0 0 22px',
}

const tag = {
  fontFamily: MONO,
  fontSize: '12px',
  letterSpacing: '0.1em',
  color: BRAND_AMBER,
  margin: '0 0 12px',
}

const SignalAlert = ({
  instrument = 'XAUUSD',
  grade = 'A',
  direction = 'long',
  entryPrice = '—',
  stopLoss = '—',
  tp1 = '—',
  tp2 = '—',
  tp3 = '—',
  rrRatio = '—',
  confidence = '—',
  breakdown = '',
  feedUrl = 'https://getptrades.com/feed',
}: SignalAlertProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${grade}-grade ${direction.toUpperCase()} setup on ${instrument}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Signal alert</Text>
        <Heading style={h1}>
          {grade}-grade {direction.toUpperCase()} · {instrument}
        </Heading>
        <Section style={panel}>
          <Text style={tag}>Trade profile</Text>
          <Text style={row}>Entry&nbsp;&nbsp;&nbsp;&nbsp;{entryPrice}</Text>
          <Text style={row}>Stop&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{stopLoss}</Text>
          <Text style={row}>TP1 1:1&nbsp;&nbsp;{tp1}</Text>
          <Text style={row}>TP2 1:2&nbsp;&nbsp;{tp2}</Text>
          <Text style={row}>TP3 1:3&nbsp;&nbsp;{tp3}</Text>
          <Text style={row}>R:R&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{rrRatio}</Text>
          <Text style={row}>Conf.&nbsp;&nbsp;&nbsp;&nbsp;{confidence}%</Text>
        </Section>
        {breakdown ? <Text style={text}>{breakdown}</Text> : null}
        <Button style={button} href={feedUrl}>
          Open the feed
        </Button>
        <Hr style={hr} />
        <Text style={footer}>
          Sent because email alerts are enabled in your P-Trades Hub settings.
          Signals are analysis, not financial advice.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: SignalAlert,
  subject: (data: Record<string, any>) =>
    `${data['grade'] ?? 'New'}-grade ${String(data['direction'] ?? 'setup').toUpperCase()} · ${data['instrument'] ?? 'signal'}`,
  displayName: 'Signal alert',
  previewData: {
    instrument: 'XAUUSD',
    grade: 'A',
    direction: 'long',
    entryPrice: '4260.24',
    stopLoss: '4251.80',
    tp1: '4268.68',
    tp2: '4277.12',
    tp3: '4285.56',
    rrRatio: '1:3.0',
    confidence: '82',
    breakdown:
      'H4, H1 and M15 moving averages are aligned bullish and price is testing the Point C liquidity zone with symmetric ABC legs.',
  },
} satisfies TemplateEntry

export default SignalAlert
