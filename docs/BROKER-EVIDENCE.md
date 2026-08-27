# Broker evidence

## Positive association only

A broker deal becomes P-Trades evidence only when its client reference parses as
one created by P-Trades. Where the broker reports a magic number, it must match as
well. Price proximity, time proximity, symbol similarity and human guesswork are
never association rules. Manual trades and other EAs are excluded.

New P-Trades MetaApi connections therefore use `manualTrades: false` with a
unique positive magic number. In MetaApi, `manualTrades` describes orders placed
through the API; it does not disable the owner's own manual MT4/MT5 trading.
MetaApi requires magic `0` when that API flag is `true`, which would make
P-Trades orders indistinguishable from manual trades and is not used here.

Closed evidence is immutable. An unreadable broker history produces an explicit
error and no new row. MetaApi deal and order history is read in 1,000-row pages;
the worker refuses to publish a partial population if its 10,000-row safety bound
is reached. Open evidence remains in the reconciliation scope after the normal
72-hour recent-delivery window and extends the history start to the original
submission/entry, so a long-running position can later become closed evidence.
An open position may have a broker entry without an exit. That one-sided state is
valid only for `open` evidence and carries no outcome R; closed evidence still
requires both broker entry and exit prices. Reconciliation records its latest
success or failure per connected account so an accepted delivery without matched
evidence is shown as awaiting evidence rather than described as an unfilled trade.

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

## Provenance

Every field in a broker-evidence row comes from the broker's own deal and order
history via MetaApi and is labelled broker-derived. Prices, volumes, commission,
swap and profit are the broker's values; R multiples are engine-derived from those
values and the published plan. Self-reported journal rows come from the user or
their assistant and are labelled as such. Benchmark rows come from the dedicated
P-Trades demo policy account. No population is derived from, or back-filled by,
another.

## Failure behaviour

An unreadable history, a truncated page walk, or a deal that cannot be positively
associated produces an explicit error or no row at all — never an inferred match.
Missing broker-held stops make `r_vs_actual_risk` unavailable rather than
approximated.

## Explicit non-guarantees

- Positive association is deliberately conservative: a genuine P-Trades trade whose
  client reference the broker did not preserve stays excluded, so evidence counts are
  a lower bound.
- The controlled benchmark is demo execution and does not predict live fills,
  slippage or commission.
- Monetary fields are not convertible into R without a valid cash value for one R.
- `HOLDOUT_AVAILABLE = false`: nothing here supports an out-of-sample claim.

## Implementation

`src/lib/evidence/*`, `src/lib/research/consent.ts`,
`src/lib/performance-evidence.server.ts`, `src/lib/performance.ts`.

## Tests

`src/lib/evidence/__tests__/*`, `src/lib/__tests__/performance*.test.ts`,
`src/test/__tests__/docs-contract.test.ts`.
