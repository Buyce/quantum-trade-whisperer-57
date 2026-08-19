import * as React from 'react'

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from '@react-email/components'

import type { TemplateEntry } from './registry'
import { MONO, brandBar, container, footer, h1, hr, main, text } from './brand'

interface TierBlock {
  label?: string
  enrolled?: number
  resolved?: number
  filled?: number
  wins?: number
  losses?: number
  neverFilled?: number
  expired?: number
  fillRate?: string
  winRate?: string
  meanR?: string
  totalR?: string
  expectancyR?: string
  medianMissAtr?: string
}

interface ComparisonBlock {
  label?: string
  highRate?: string
  lowRate?: string
  highN?: number
  lowN?: number
  difference?: string
  z?: string
  pValue?: string
  verdict?: string
  note?: string
}

interface WeeklyShadowReportProps {
  isoWeek?: string
  windowStart?: string
  windowEnd?: string
  totalResolved?: number
  high?: TierBlock
  low?: TierBlock
  comparisons?: ComparisonBlock[]
}

const mono = { ...text, fontFamily: MONO, fontSize: '13px', margin: '0 0 6px' }
const subhead = { ...text, fontWeight: 700, margin: '0 0 8px' }

const Tier = ({ tier }: { tier: TierBlock }) => (
  <>
    <Text style={subhead}>{tier.label ?? 'tier'}</Text>
    <Text style={mono}>enrolled: {tier.enrolled ?? 0}</Text>
    <Text style={mono}>resolved: {tier.resolved ?? 0}</Text>
    <Text style={mono}>filled: {tier.filled ?? 0}</Text>
    <Text style={mono}>
      wins / losses: {tier.wins ?? 0} / {tier.losses ?? 0}
    </Text>
    <Text style={mono}>
      never filled / expired: {tier.neverFilled ?? 0} / {tier.expired ?? 0}
    </Text>
    <Text style={mono}>fill rate: {tier.fillRate ?? 'n/a'}</Text>
    <Text style={mono}>win rate (of filled): {tier.winRate ?? 'n/a'}</Text>
    <Text style={mono}>mean R: {tier.meanR ?? 'n/a'}</Text>
    <Text style={mono}>total R: {tier.totalR ?? 'n/a'}</Text>
    <Text style={mono}>expectancy: {tier.expectancyR ?? 'n/a'}</Text>
    <Text style={mono}>median miss distance (unfilled): {tier.medianMissAtr ?? 'n/a'}</Text>
  </>
)

const WeeklyShadowReportEmail = ({
  isoWeek,
  windowStart,
  windowEnd,
  totalResolved,
  high = {},
  low = {},
  comparisons = [],
}: WeeklyShadowReportProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      Weekly shadow report {isoWeek ?? ''} — A/A+ vs B/C, {totalResolved ?? 0} resolved setups
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brandBar}>P-Trades Hub · Shadow telemetry</Text>
        <Heading style={h1}>Weekly shadow report — {isoWeek ?? 'this week'}</Heading>
        <Text style={text}>
          Forward-test results from the shadow engine for {windowStart ?? '?'} to{' '}
          {windowEnd ?? '?'} (UTC), split into the high tier (A, A+) and the low tier (B, C).
          Every number below is an aggregate over live replayed setups — {totalResolved ?? 0}{' '}
          resolved in the window.
        </Text>

        <Hr style={hr} />
        <Tier tier={high} />
        <Hr style={hr} />
        <Tier tier={low} />
        <Hr style={hr} />

        <Text style={subhead}>Statistical significance (two-proportion z-test)</Text>
        {comparisons.length === 0 ? (
          <Text style={mono}>no comparisons available</Text>
        ) : (
          comparisons.map((c, i) => (
            <React.Fragment key={i}>
              <Text style={{ ...mono, marginTop: '10px' }}>{c.label ?? 'comparison'}</Text>
              <Text style={mono}>
                A/A+ {c.highRate ?? 'n/a'} (n={c.highN ?? 0}) vs B/C {c.lowRate ?? 'n/a'} (n=
                {c.lowN ?? 0})
              </Text>
              <Text style={mono}>
                difference: {c.difference ?? 'n/a'} · z: {c.z ?? 'n/a'} · p: {c.pValue ?? 'n/a'}
              </Text>
              <Text style={mono}>verdict: {c.verdict ?? 'n/a'} — {c.note ?? ''}</Text>
            </React.Fragment>
          ))
        )}

        <Hr style={hr} />
        <Text style={footer}>
          A tier needs at least 30 resolved samples before a comparison is reported; below that
          the verdict is "insufficient" and no conclusion is drawn. These statistics are
          observational — grading, alerting and the daily setup limit do not read them. Sent once
          per ISO week.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: WeeklyShadowReportEmail,
  subject: (data: Record<string, any>) =>
    `P-Trades Hub — weekly shadow report ${data['isoWeek'] ?? ''} (A/A+ vs B/C)`,
  displayName: 'Weekly shadow report (admin)',
  to: 'boatengampomah@gmail.com',
  previewData: {
    isoWeek: '2026-W34',
    windowStart: '2026-08-12',
    windowEnd: '2026-08-19',
    totalResolved: 41,
    high: {
      label: 'A / A+',
      enrolled: 6,
      resolved: 5,
      filled: 3,
      wins: 2,
      losses: 1,
      neverFilled: 2,
      expired: 0,
      fillRate: '60.0%',
      winRate: '66.7%',
      meanR: '0.84R',
      totalR: '2.51R',
      expectancyR: '0.84R',
      medianMissAtr: '0.91 ATR',
    },
    low: {
      label: 'B / C',
      enrolled: 44,
      resolved: 36,
      filled: 16,
      wins: 6,
      losses: 10,
      neverFilled: 18,
      expired: 2,
      fillRate: '44.4%',
      winRate: '37.5%',
      meanR: '-0.09R',
      totalR: '-1.44R',
      expectancyR: '-0.09R',
      medianMissAtr: '1.12 ATR',
    },
    comparisons: [
      {
        label: 'Fill rate (filled / resolved)',
        highRate: '60.0%',
        lowRate: '44.4%',
        highN: 5,
        lowN: 36,
        difference: '15.6 pts',
        z: 'n/a',
        pValue: 'n/a',
        verdict: 'insufficient',
        note: 'Not enough data: 5 vs 36 samples (need 30 per tier). No conclusion drawn.',
      },
    ],
  },
} satisfies TemplateEntry

export default WeeklyShadowReportEmail
