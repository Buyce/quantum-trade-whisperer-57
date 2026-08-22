# Journal and canonical R

## Purpose

Record what the trader actually did, and express the result in R with explicit
provenance. `src/lib/journal/r-math.ts` is the single canonical implementation.

## Current behaviour

### Snapshot at first creation

When a journal row is first created, the published plan is snapshotted onto it
(planned entry, planned stop, direction, instrument, grade, session). Later edits
to the signal, or its expiry and removal, cannot retroactively change what the
trade was measured against.

### The two R measures

```text
gross_move       = long ? actual_exit - actual_entry
                        : actual_entry - actual_exit

r_vs_plan        = gross_move / abs(planned_entry - planned_stop)

stop_ref         = actual_initial_stop ?? planned_stop
r_vs_actual_risk = gross_move / abs(actual_entry - stop_ref)
```

The **actual fill is always the numerator anchor** for both. Realised movement is
never computed from the planned entry.

`r_vs_plan` answers "how did the plan pay off". `r_vs_actual_risk` answers "how
did the risk I actually took pay off". They are **different units of account**.
Both may exist on one trade, and they are never averaged together — basis
selection is explicit and enforced by `src/lib/journal/basis.ts`.

### Provenance fields

| Field | Meaning |
| --- | --- |
| `r_availability` | `both`, `plan_only`, `actual_risk_only`, or an explicit `unavailable_*` reason |
| `stop_provenance` | `actual_stop`, `planned_stop_fallback`, or `unavailable` |
| `r_math_version` | Stamp of the formula that produced the value (`R_MATH_VERSION`) |
| price author | Who wrote each price — the user or a named AI agent |

All R values are rounded to `R_DECIMALS` (4) for storage and comparison.

### Rejected input

Structurally impossible input throws rather than producing a half-truth:

- `one_sided_prices` — a resolved trade with an entry but no exit (or vice versa)
  is a data-entry error, not a null R.
- `non_finite`, `non_positive_price`.
- `impossible_stop_geometry` — a long's actual initial stop must be below its fill
  and a short's above it; wrong-side or zero-distance stops are refused instead of
  being turned into a plausible `r_vs_actual_risk` by an `abs()`.

### Costs

Commission and swap are monetary, not price distances. Net R exists **only** when
a documented monetary value of 1R was recorded for that trade. Otherwise the
status is `no_conversion_provenance` and the UI says "gross R only" — it never
presents a cost-adjusted figure it could not compute.

### Immutability

A resolved trade is immutable at the database layer, so published history stays
reproducible. Deleting a history entry is an explicit user action, not an edit.

## Inputs

Outcome (`win`/`loss`/`breakeven`/`open`), direction, snapshotted planned entry and
stop, actual entry and exit, optional actual initial stop, optional commission,
swap and documented 1R value.

## Outputs

`r_vs_plan`, `r_vs_actual_risk`, availability, stop provenance, gross move,
planned risk, actual risk, math version; and optionally net R with a status.

## Provenance

Every price in this subsystem is **self-reported** — entered by the trader or by
their connected assistant — unless a broker source is proven for that specific
value. It is never labelled simply "verified".

## Failure behaviour

An open trade yields `unavailable_open`. A null direction yields
`unavailable_no_direction`; direction is **never** inferred and nothing is assumed
to be long. Missing prices yield `unavailable_no_prices`. Zero risk yields
`unavailable_zero_risk`.

## User-facing meaning

`+1.5R` means the trade returned one and a half times the risk of the basis shown
next to it. If no basis is shown, no R was computable.

## What the journal does not guarantee

That the recorded prices match the broker's fills. It records what was reported,
with the author attached, so bad data can be traced — not proven correct.

## Implementation

`src/lib/journal/r-math.ts`, `basis.ts`, `decision.ts`, `display.ts`,
`verify-reminders.server.ts`, `src/lib/trade-journal.functions.ts`,
`src/routes/_authenticated/history.tsx`.

## Tests

`src/lib/journal/__tests__/r-math.test.ts`,
`src/lib/journal/__tests__/no-direction-fallback.test.ts`,
`src/test/db/__tests__/resolved-immutability.db.test.ts`.
