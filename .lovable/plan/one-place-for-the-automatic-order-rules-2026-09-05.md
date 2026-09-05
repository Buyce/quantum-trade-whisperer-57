# One place for the automatic-order rules

Short answer first: the three groups do **not** conflict. They act on three
different questions, and none of them can overrule a safety check. But they are
currently split across the page, so they read like competing switches. The fix is
presentation: gather them under one heading with a plain-language summary of what
is in force right now.

## What each one actually decides

**Order ceilings at submission** (max spread at entry, max slippage from entry,
max total exposure) — *the price and exposure quality of a single order.* Checked
immediately before an order is sent, against your broker's own quote and
specification. 0 turns a ceiling off. If a ceiling is set but the broker figure
needed to measure it is missing, the order is refused rather than sent.

**Move the daily ceilings with broker data freshness** — *how many automatic
orders you allow, not their price.* When on, your daily and per-instrument order
counts move between your own floor and your own maximum depending on how recent
the broker equity and price readings behind sizing are: fresh raises toward your
maximum, stale or missing lowers to your floor. It can never exceed the maximum
you typed, and never changes an order's price, size or stop.

**Enter eligible orders immediately at market** — *where an already-approved
order goes in.* Off means the order rests as a planned limit. On means a
qualifying order is sent at market on its first dispatch, but only while the live
price is still inside the setup's published maximum acceptable entry; past that
ceiling it is still refused.

## How they interact (the one thing worth knowing)

They chain, they don't compete: freshness decides *how many* orders may exist
today, market entry decides *how* an order goes in, and the submission ceilings
decide *whether this particular order's price and exposure are acceptable*.
Whichever check refuses first wins.

The interaction users mistake for a conflict: with market entry ON, the slippage
and spread ceilings are the controls that keep an immediate entry honest. Set to
0 they are off, so an immediate market entry is bounded only by the setup's
maximum acceptable entry. That is a real trade-off to state on the page, not a
bug.

## What changes

Settings only — no engine, sizing, gate or database change.

1. Group all three under one section, "Automatic order rules", with three
   labelled sub-blocks in decision order:
   - How many orders (daily / per-instrument / concurrent / freshness-adaptive)
   - How an order enters (immediate market entry)
   - What price and exposure is acceptable (spread, slippage, total exposure)
2. Add a short "what is in force now" summary line at the top of the section,
   built from the values already on screen, e.g. "Up to 10 orders a day, resting
   as planned limits, refused above 2 pips spread and above 10% total exposure."
3. Add one sentence under market entry stating that spread and slippage ceilings
   are what bound an immediate entry, and that 0 means unbounded except the
   setup's maximum acceptable entry.
4. Keep every existing field name, help text meaning, validation and save
   behaviour; nothing is renamed in the database.

## Technical notes

- Change is confined to `src/routes/_authenticated/settings.tsx` (section order,
  headings, one derived summary string) plus a Guide entry in `GuideMode.tsx`.
- No change to `user-ceilings.ts`, `adaptive-ceilings.ts`,
  `direct-enqueue.server.ts` or `revalidate.server.ts`; enforcement order and
  fail-closed behaviour stay exactly as they are.
- Summary line is derived from current form state only — it never asserts broker
  state, and it reads "off" when a value is 0.
