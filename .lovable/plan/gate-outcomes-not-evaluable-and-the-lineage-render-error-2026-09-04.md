# Gate outcomes: "not evaluable", and the lineage render error

## What "not evaluable" means

The scanner grades every setup through a fixed ladder of 8 gates, in order
(candles present → M15 direction → ABC structure → grade → risk defined →
risk ceiling → headroom → reachable R). The ladder short-circuits: as soon as
one gate fails, the setup is finished and **every later gate is recorded as
`not_evaluable`** rather than pass or fail.

So `not_evaluable` does not mean "broken" or "missing data". It means
truthfully: "we never got to this test, because the setup was already out."

Your numbers are exactly consistent with that:

```text
candles_present  pass 1440  fail 0                  <- every evaluation
m15_direction    pass  667  fail 773                <- 773 stop here
abc_structure    pass  667  fail 0    not_eval 773  <- the 773 above
grade            pass  667  fail 0    not_eval 773
risk_defined     pass  525  fail 0    not_eval 915  <- 773 + 142 earlier exits
headroom         pass  525  fail 0    not_eval 915
risk_ceiling     pass  525  fail 83   not_eval 832
reachable_r      pass  525  fail 59   not_eval 856
```

The dominant cause is a single gate: **773 of 1440 evaluations had no M15
direction agreement**, which is the normal, expected filter — most bars are
simply not a setup.

## How it affects us

- It does not distort research. Filter lift only compares arms that carry a
  complete research plan; rows with a `not_evaluable` gate are excluded from
  enrolment, so they are never counted as if they had passed.
- It is why enrolable backlog is much smaller than captured candidates.
- No fix required. The alternative (evaluating every gate on setups that
  already failed) would fabricate verdicts on undefined geometry.

## What does need a fix

The screenshot also shows a real bug below the gate table:

```text
Candidate lineage failed to render
Cannot read properties of undefined (reading 'toFixed')
```

`CandidateLineagePanel` guards its numeric fields with `=== null`, but the
lineage RPC omits keys when a value is absent, so the field arrives as
`undefined` and slips past the guard into `.toFixed(2)`.

### Change

- In `src/components/admin/CandidateLineagePanel.tsx`, replace the strict
  `=== null` checks on `shadow_realized_r`, `broker_net_profit` and
  `broker_r_vs_plan` with a small numeric formatter that renders an em dash for
  null, undefined or non-finite values and only formats real numbers.
- Add a unit test covering null, undefined and finite inputs for the replay and
  broker cell builders.

No backend, scanner, enrolment or research-logic changes. Missing money or R
stays visibly missing — nothing is defaulted to zero.
