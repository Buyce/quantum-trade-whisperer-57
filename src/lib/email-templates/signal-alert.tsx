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
  maxAcceptableEntry?: string
  stopLoss?: string
  tp1?: string
  tp2?: string
  tp3?: string
  tp1Label?: string
  tp2Label?: string
  tp3Label?: string
  orderType?: string
  tifMinutes?: string
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

const rowStrong = {
  ...row,
  fontWeight: 700,
  color: BRAND_AMBER,
}

const panel = {
  border: `1px solid ${BRAND_BORDER}`,
  borderRadius: '6px',
  padding: '16px 18px',
  margin: '0 0 18px',
}

const callout = {
  border: `1px solid ${BRAND_AMBER}`,
  borderRadius: '6px',
  padding: '16px 18px',
  margin: '0 0 18px',
}

const tag = {
  fontFamily: MONO,
  fontSize: '12px',
  letterSpacing: '0.1em',
  color: BRAND_AMBER,
  margin: '0 0 12px',
}

const ruleText = {
  ...text,
  margin: '0 0 8px',
}

/** Fixed-width label so the mono rows line up in every mail client. */
const pad = (label: string) => label.padEnd(22, ' ').replace(/ /g, '\u00A0')

const SignalAlert = ({
  instrument = 'XAUUSD',
  grade = 'A',
  direction = 'long',
  entryPrice = '—',
  maxAcceptableEntry = '—',
  stopLoss = '—',
  tp1 = '—',
  tp2 = '—',
  tp3 = '—',
  tp1Label = '1:1',
  tp2Label = '1:2',
  tp3Label = '1:3',
  orderType = 'BUY LIMIT',
  tifMinutes = '30',
  rrRatio = '—',
  confidence = '—',
  breakdown = '',
  feedUrl = 'https://getptrades.com/feed',
}: SignalAlertProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${grade}-grade ${direction.toUpperCase()} on ${instrument} — entry ${entryPrice}, do not chase beyond ${maxAcceptableEntry}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Signal alert</Text>
        <Heading style={h1}>
          {grade}-grade {direction.toUpperCase()} · {instrument}
        </Heading>

        <Section style={panel}>
          <Text style={tag}>Trade profile · {orderType}</Text>
          <Text style={row}>{pad('Entry (limit)')}{entryPrice}</Text>
          <Text style={rowStrong}>{pad('Max acceptable entry')}{maxAcceptableEntry}</Text>
          <Text style={row}>{pad('Stop-loss')}{stopLoss}</Text>
          <Text style={row}>{pad(`TP1 ${tp1Label}`)}{tp1}</Text>
          <Text style={row}>{pad(`TP2 ${tp2Label}`)}{tp2}</Text>
          {tp3 && tp3 !== '—' ? (
            <Text style={row}>{pad(`TP3 ${tp3Label}`)}{tp3}</Text>
          ) : null}
          <Text style={row}>{pad('R:R')}{rrRatio}</Text>
          <Text style={row}>{pad('Confidence')}{confidence}%</Text>
          <Text style={row}>{pad('Grade')}{grade}</Text>
        </Section>

        <Section style={callout}>
          <Text style={tag}>Execution rule</Text>
          <Text style={ruleText}>
            If your broker price is currently beyond {maxAcceptableEntry}, DO NOT enter at market.
            Place a Limit Order at {entryPrice} to catch the retest.
          </Text>
          <Text style={ruleText}>
            Beyond that price the payoff this grade was calculated on no longer holds. A limit order
            is the only order type your platform will accept back at the entry once price has moved
            past it.
          </Text>
        </Section>

        <Section style={panel}>
          <Text style={tag}>Expiration</Text>
          <Text style={ruleText}>
            Cancel this order if it is not filled within {tifMinutes} minutes (2 candles). An
            unfilled setup after that point belongs to a different market than the one that was
            graded.
          </Text>
        </Section>

        {breakdown ? <Text style={text}>{breakdown}</Text> : null}

        <Button style={button} href={feedUrl}>
          Check Live Distance on Terminal
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
    maxAcceptableEntry: '4261.51',
    stopLoss: '4251.80',
    tp1: '4268.68',
    tp2: '4277.12',
    tp3: '4285.56',
    tp1Label: '1:1',
    tp2Label: '1:2',
    tp3Label: '1:3',
    orderType: 'BUY LIMIT',
    tifMinutes: '30',
    rrRatio: '1:3.0',
    confidence: '82',
    breakdown:
      'H4, H1 and M15 moving averages are aligned bullish and price is testing the Point C liquidity zone with symmetric ABC legs.',
  },
} satisfies TemplateEntry

export default SignalAlert
