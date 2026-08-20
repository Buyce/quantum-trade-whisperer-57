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
  BRAND_BORDER,
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

interface UnverifiedTrade {
  instrument?: string
  direction?: string
  outcome?: string
  date?: string
}

interface VerifyTradePricesProps {
  missingCount?: number
  trades?: UnverifiedTrade[]
  historyUrl?: string
}

const rowBox = {
  border: `1px solid ${BRAND_BORDER}`,
  borderRadius: '6px',
  padding: '12px 14px',
  margin: '0 0 8px',
}

const mono = {
  ...text,
  fontFamily: MONO,
  fontSize: '13px',
  margin: '0',
}

const VerifyTradePricesEmail = ({
  missingCount = 0,
  trades = [],
  historyUrl = 'https://getptrades.com/history',
}: VerifyTradePricesProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${missingCount} logged ${missingCount === 1 ? 'trade is' : 'trades are'} missing fill prices`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Trade journal</Text>
        <Heading style={h1}>
          {missingCount} of your logged {missingCount === 1 ? 'trade' : 'trades'} still
          {missingCount === 1 ? ' has' : ' have'} no fill prices
        </Heading>
        <Text style={text}>
          You marked these setups as taken and recorded a result, but not the prices
          you actually got. Without your real entry and exit price the R multiple
          cannot be calculated, so those wins and losses stay unverified.
        </Text>
        <Text style={text}>
          Add both prices in the Trade History tab and the terminal recomputes the R
          from the setup&apos;s own risk distance — a number that is reproducible
          instead of self-reported, and that makes your win rate meaningful.
        </Text>

        {trades.length ? (
          <Section>
            {trades.map((t, i) => (
              <Section key={i} style={rowBox}>
                <Text style={mono}>
                  {t.instrument ?? 'unknown'} · {(t.direction ?? '').toUpperCase()} ·{' '}
                  {(t.outcome ?? '').toUpperCase()} · {t.date ?? ''}
                </Text>
              </Section>
            ))}
          </Section>
        ) : null}

        <Section style={{ margin: '24px 0 0' }}>
          <Button style={button} href={historyUrl}>
            Add my fill prices
          </Button>
        </Section>

        <Hr style={hr} />
        <Text style={footer}>
          Prices are always optional — nothing in your history is deleted or changed
          if you skip this. You receive this reminder at most once a week, and only
          while trades are still missing prices.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: VerifyTradePricesEmail,
  subject: (data: Record<string, any>) => {
    const n = Number(data['missingCount'] ?? 0)
    return n === 1
      ? 'P-Trades Hub — 1 logged trade is missing its fill prices'
      : `P-Trades Hub — ${n} logged trades are missing fill prices`
  },
  displayName: 'Verify trade prices',
  previewData: {
    missingCount: 3,
    trades: [
      { instrument: 'XAUUSD', direction: 'long', outcome: 'win', date: '18 Aug 2026' },
      { instrument: 'EURUSD', direction: 'short', outcome: 'loss', date: '17 Aug 2026' },
      { instrument: 'GBPAUD', direction: 'long', outcome: 'win', date: '15 Aug 2026' },
    ],
    historyUrl: 'https://getptrades.com/history',
  },
} satisfies TemplateEntry

export default VerifyTradePricesEmail
