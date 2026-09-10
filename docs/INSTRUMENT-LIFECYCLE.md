# Instrument lifecycle

An instrument earns its way into the product one capability at a time. Being
_defined_ in the code does not make an instrument scannable; being scanned does
not make it publishable; being publishable does not make it executable. Each of
those is a separate, explicit database decision.

## The registry: one definition authority

`src/lib/instruments/registry.ts` holds every instrument the system knows about —
symbol, label, base/quote currencies, contract size, minimum lot, lot step,
fallback digits and the validated stop-distance floor. Everything else derives
from it:

| Consumer               | What it takes from the registry      |
| ---------------------- | ------------------------------------ |
| `lib/scanner/types.ts` | the scan universe, stop floors       |
| `lib/risk.ts`          | contract specifications              |
| `lib/db-types.ts`      | labels, the settings instrument list |

Wave 0 is `XAUUSD`, `GBPAUD`, `EURUSD`. Wave 1 admits `GBPUSD`, `USDJPY`,
`AUDUSD`, `USDCAD`, `USDCHF` as definitions only.

A registry entry carries `spreadFloor: null` until a floor has been **measured**
from broker specifications for that symbol. A null floor is not a permissive
default: publication of that instrument stays blocked rather than falling back to
a guessed distance. JPY pairs are given three fallback digits, so a "point" is
never silently mis-scaled by a factor of a hundred.

## Stages

Stages live in `instrument_lifecycle` (one row per symbol), and every change is
appended to `instrument_lifecycle_transitions` with actor and reason. Both tables
are service-role write only; users read a restricted `instrument_stages` view
exposing symbol and stage.

| Stage                | Scanned | Published | Executable |
| -------------------- | ------- | --------- | ---------- |
| `disabled`           | no      | no        | no         |
| `data_validation`    | yes     | no        | no         |
| `shadow`             | yes     | no        | no         |
| `signals_only`       | yes     | yes       | no         |
| `execution_approved` | yes     | yes       | yes        |
| `suspended`          | no      | no        | no         |

`suspended` is a revocation, not a rank: it withdraws every capability however
far the instrument had progressed.

## What the user sees

The terminal collapses the stage into three user-visible states, so a reachable
broker feed is never mistaken for availability:

| User-visible state | Stages                               | Feed strip label              | Selectable in Settings |
| ------------------ | ------------------------------------ | ----------------------------- | ---------------------- |
| measuring          | `data_validation`, `shadow`          | measuring — not published yet | no                     |
| publishable        | `signals_only`, `execution_approved` | live feed                     | yes                    |
| out of service     | `disabled`, `suspended`              | not in service                | no                     |

The Settings instrument list is **derived** from the restricted
`instrument_stages` view via `publishableInstruments()` in `lib/db-types.ts`, not
from a frozen wave constant: a legitimately promoted pair appears without a code
change, and a stage-read failure falls back to Wave 0 only. Saving also filters
out any previously selected symbol that is no longer publishable.

The rules are pure functions in `src/lib/instruments/lifecycle.ts`
(`mayScan`, `mayPublish`, `mayExecute`) so the same predicate answers the scanner,
the alert path and the pre-send gate.

## Where the gates sit

- **Scan enqueue and publication** — `lib/scanner/pipeline.server.ts`. A
  research-stage instrument is measured and enrolled for study; nothing it
  produces reaches a user feed.
- **Alert and feed eligibility** — `lib/delivery/eligibility.ts`.
- **Order enqueue and pre-send revalidation** —
  `lib/delivery/direct-enqueue.server.ts` and `lib/delivery/revalidate.server.ts`,
  which refuse with `instrument_not_approved` and name the stage in the refusal.

Enforcement is itself flagged: `execution_controls.lifecycle_enforced`. When the
stage table cannot be read, the fallback is deliberately asymmetric — Wave 0
falls back to `execution_approved` (current behaviour is preserved) and every
other symbol falls back to `disabled` (nothing new goes live on a read failure).

## Opt-in, never opt-out

An empty instrument preference resolves to **Wave 0 only**, not "everything".
Promoting a new pair therefore cannot silently start delivering it to existing
users: each user has to select it. This is asserted, not assumed.

## Readiness

`src/lib/instruments/readiness.server.ts` is the evidence a promotion decision
rests on. For a symbol it checks broker symbol mapping, a retrievable
specification, candle availability across the traded timeframes, a live quote
with valid geometry and a fresh broker source timestamp (the same staleness rule
the pre-send gate uses), and an available account-currency conversion route. It
reports a measured `spreadFloorCandidate` rather than inventing one.

A single malformed tick is not a capability verdict. Production saw GBPUSD fail
readiness on one zero-spread tick and USDCHF's own conversion leg recorded as
unquotable from one failed fetch. The quote check and every conversion leg
therefore re-ask a fixed, bounded number of times
(`src/lib/instruments/quote-retry.ts`), record how many attempts were spent, and
distinguish "the tick was malformed" from "there was no quote at all". A feed that
is malformed on every attempt still fails.

## Operator symbol bindings

Brokers rename instruments. Alias discovery
(`src/lib/instruments/discovery.server.ts`) reads the broker's own symbol
inventory and accepts a name only when exactly one candidate matches. In
production it found `NAS100` ambiguous between `USTEC` and `USTECH100M`, `USOIL`
ambiguous across five WTI variants, and no Brent-like name for `UKOIL` at all. It
refuses to choose, because a guessed ticker can size and route an order against a
different contract.

A **binding** (`instrument_symbol_bindings`, written only through the owner-only
admin surface) is how that deadlock is broken: a named person records the one
broker symbol a canonical instrument means, together with the candidate list that
was on the table and who decided. The ticker must appear in the broker's live
inventory before the binding is accepted.

What a binding does and does not do:

- The specification refresh then asks the provider for the **bound** symbol and
  records, on the specification row, which name it was fetched under.
- Mapping treats a binding as `configured`, and as usable **only** when a
  specification exists that was fetched under that exact name and is inside the
  freshness window. A binding with no provider answer behind it stays
  `never_verified`.
- Only one broker symbol is bound per canonical instrument. Fanning one idea out
  across every broker variant would duplicate correlated alerts, consume several
  daily-cap slots for one setup, distort win rate and expectancy, and size against
  contract specifications that differ per variant.
- A binding changes no lifecycle stage, publishes nothing and places no order. The
  instrument still has to earn readiness, sampling and the promotion checkpoint
  below.

The same admin surface can run a single-instrument commissioning recheck on
demand (discovery, specification refresh, readiness snapshot). It writes evidence
only.

## Promotion checkpoint (`data_validation` to `shadow`)

Readiness says the provider can serve an instrument now. It does not say the
instrument has been observed long enough to be measured. `promotion.ts` is the
pure evidence gate for that, and every criterion is arithmetic over recorded rows:

- at least 5 distinct UTC trading days of valid spread samples, and at least 200
  valid samples in total;
- a valid sample in every session the sampler covers;
- sample missingness at or below 20%;
- a readiness snapshot no older than 24 hours that passed, with both the
  conversion route and the live conversion data proven;
- a verified provider symbol that did not change during the window;
- a spread floor candidate derived from real samples.

Absent evidence is a blocker, never a pass. The checkpoint renders in Admin
Intelligence as promotable/blocked with each unmet criterion and its measured
value. It changes no stage itself: `transition_instrument_stage` remains the only
way a stage changes, and both the operator and the automatic ladder below go
through it.

Sample counts, distinct days, session coverage, observed provider symbols and
missingness are computed **inside the database** by
`get_promotion_sample_evidence` (service role only), one row per instrument.
Reading raw sample rows through the data API truncated at its row ceiling, so a
fortnight of collection was counted as roughly the newest three days and the
5-day / 200-sample gate was unreachable by construction. Missingness is one
window-wide percentage of sampler attempts that produced no usable tick. A failed
aggregate read yields no evidence, which blocks — never a silent under-count.

## Automatic stage advancement

`advancement.ts` (pure rules) and `advancement.server.ts` (evidence + apply) climb
the ladder without an operator, once a day at 05:40 UTC via
`/api/public/cron/advance-instruments`. Four invariants:

1. **Evidence or nothing.** Every input is nullable and `null` blocks. Nothing is
   inferred, defaulted, or carried over from a previous day.
2. **One rung per instrument per UTC day, never skipped** — `data_validation` ->
   `shadow` -> `signals_only` -> `execution_approved`. Every rung is therefore
   observed live for a full day before the next is considered.
3. **It only ever moves an instrument forward.** Degraded evidence blocks a
   promotion and is recorded; a move to a LOWER stage is a human decision, taken
   through the audited transition path.
4. **`execution_approved` is permission, not an instruction.** The global
   execution switch, per-account settings, risk brakes and the intelligence gate
   are untouched by this job.

Gates per rung:

| Rung                                   | Requires                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data_validation` -> `shadow`          | the promotion checkpoint above, verbatim                                                                                                                                                                         |
| `shadow` -> `signals_only`             | 30+ resolved replay outcomes over 10+ UTC days, positive full-payoff expected R whose cluster-bootstrap interval stays above zero, missingness at or below 20%, at most one failed readiness check in the window |
| `signals_only` -> `execution_approved` | all of the above, the same standard on post-publication outcomes, and a chronological holdout (later 30% of observed days, 30+ outcomes over 5+ instrument-days) whose interval also stays above zero            |

Degraded evidence — missingness above 20%, more than one failed readiness check in
the window, or expectancy negative across the whole confidence interval — holds the
instrument exactly where it is and is shown as the blocking reason. The job never
demotes. `suspended` and `disabled` are never touched automatically.

The kill switch is `execution_controls.auto_stage_advance_enabled` and it **fails
closed**: unreadable means nothing moves. Every applied change is written through
`transition_instrument_stage` with approver `auto-advance`, the reasons and the
window attached, and it is emailed to the owner and shown in Admin Intelligence
under "Automatic stage ladder", which also renders the next decision and its
blockers as a dry run.

## Provenance

Every value here is broker-derived or operator-recorded. Contract sizes, lot
steps and digits come from broker symbol specifications; candle and quote checks
come from live provider responses; stages and transitions come from recorded
operator decisions with an actor and a reason. Nothing on this page is simulated,
seeded or back-filled.

## Non-guarantees

- A stage does **not** describe broker state. `execution_approved` means P-Trades
  permits an order for that symbol, not that the broker will accept, fill, or
  price it as planned.
- Readiness passing does **not** predict profitability. It only says the data
  needed to measure the instrument honestly is present.
- A measured `spreadFloorCandidate` is a candidate. It is not a floor until it is
  written into the registry.
- Wave 1 pairs are not tradeable simply because they appear in the registry or in
  the stage view.

## Tests

- `src/lib/instruments/__tests__/registry-parity.test.ts` pins every Wave 0
  literal (universe, contract specs, stop floors, labels) against frozen values,
  asserts the stage capability matrix including `suspended` revocation and the
  asymmetric read-failure fallback, and asserts that an empty preference means
  Wave 0 rather than every instrument.
- `src/lib/instruments/__tests__/symbol-binding.test.ts` asserts that a bound
  instrument is fetched under the broker symbol, that an unbound one keeps its
  canonical name, and that an unreadable binding table falls back to the canonical
  name rather than to a guess.
- `src/test/__tests__/docs-contract.test.ts` keeps this document aligned with the
  scan universe in code.
