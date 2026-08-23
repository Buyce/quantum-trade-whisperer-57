# Broker evidence

## Positive association only

A broker deal becomes P-Trades evidence only when its client reference parses as
one created by P-Trades. Where the broker reports a magic number, it must match as
well. Price proximity, time proximity, symbol similarity and human guesswork are
never association rules. Manual trades and other EAs are excluded.

Closed evidence is immutable. An unreadable broker history produces an explicit
error and no new row.

Instrument, grade, detection time and market-context fields are snapshotted when
evidence is first observed. Performance therefore does not invent metadata or
depend on the short production-signal retention window.

## Populations

| Evidence class              | Performance label            | Identity boundary                                           |
| --------------------------- | ---------------------------- | ----------------------------------------------------------- |
| `self_reported` journal     | **SELF-REPORTED JOURNAL**    | User/assistant-authored prices; unverified against a broker |
| `customer` broker evidence  | **CUSTOMER BROKER EVIDENCE** | Only the signed-in user's positively associated deals       |
| `benchmark` broker evidence | **CONTROLLED BENCHMARK**     | Dedicated P-Trades demo policy; sanitized aggregate surface |

The populations are queried separately and never fall back to one another. The
controlled benchmark is demo evidence, not live performance and not deterministic
scanner replay.

## Dual R

`r_vs_plan` measures the actual price move against the published plan risk.
`r_vs_actual_risk` measures it against the initial stop the broker actually held.
A missing broker-held stop makes the second value unavailable; the submitted stop
is not silently substituted. Consumers choose one basis explicitly. The bases are
never averaged together.

Commission, swap and gross profit remain monetary broker fields. They are not
silently folded into price-distance R without a valid cash value for one R.

## Research estimands

Pooled customer research requires valid current consent at observation time and
uses only a random pseudonymous account reference. Dependence-aware research
clusters by `signal_id` and whole UTC day. `HOLDOUT_AVAILABLE = false`, so no
out-of-sample claim is permitted.

## Implementation

`src/lib/evidence/*`, `src/lib/research/consent.ts`,
`src/lib/performance-evidence.server.ts`, `src/lib/performance.ts`.
