# Full audit: is everything written down still true?

## Short answer

No. The app itself is in good shape and unusually honest — but the writing around
it has fallen behind the last few weeks of work. I checked all 27 documents, the
README, the roadmap, every page's on-screen wording, the help centre, the code
comments and the formatting, against what the code and the live database actually
do today. Nine real problems, listed below in the order I'd fix them.

Nothing I found is a safety problem, and nothing invents data. Every issue is
either something true that was never written down, or something written down that
has since changed.

## What is genuinely correct (verified, no action)

- Every "empty view" and "No Trade" wording rule is respected everywhere. No page
  claims a scanner-wide verdict from a filtered list.
- Help centre and Feed wording agree with each other and with the rules.
- The published-markets, assistant-tool-count, retention-window and
  confluence-weighting figures in the README all match the code exactly.
- Every page has its own title and description. No page is missing one.
- No leftover developer notes, no unfinished markers anywhere in the codebase.

## The nine problems

### 1. Two whole features have never been written down
Execution-quality scoring and the automatic 24-hour cooldowns exist, run hourly,
and have their own Admin panel — but no document mentions them at all. The same is
true of the ranking that decides which setups spend a limited daily allowance.
Fix: add a new document for execution quality and cooldowns; add the ranking to
the existing execution document.

### 2. The safety limits are missing from the help centre
Six live Settings controls have careful on-screen explanations but no help-centre
entry: the loss/drawdown pause limits, the moving daily ceilings, entering at
market, letting unmeasured setups through, the per-market and simultaneous order
ceilings, and the outbound webhook.
Fix: two new help-centre sections — "Safety limits that pause trading" and
"Order ceilings and outbound delivery."

### 3. The homepage promises broker monitoring the help centre never explains
The homepage names two broker monitoring features by name; searching the help
centre for either returns nothing.
Fix: one help-centre entry covering both, stating plainly that they are
after-the-fact monitoring, not a safeguard before an order is sent.

### 4. The operations document names the wrong markets
It says eight markets are being sampled and lists five as under measurement. The
database says six are under measurement — one index market was added on
3 September and is missing from the list. The document also still says a review
window "closes around 1 September", which has passed.
Fix: rewrite that section from the live stage table and remove the dated sentence.

### 5. Six Admin panels are built but not on the page
Six panel files exist and look production-ready but are not shown anywhere. Some
were removed on purpose; at least one looks like an oversight, and one dated audit
still tells the reader to go and use one of them.
Fix: confirm each one against its removal note, then either delete it or put it
back. I'd flag which is which before touching anything.

### 6. The roadmap contradicts itself
Its most recent entry says to remove the promotion panel and keep the symbol
bindings panel. The opposite happened afterwards, on your instruction. Three
older items are also still open although two are now decided.
Fix: bring the roadmap in line with what actually shipped.

### 7. Statistics vocabulary doesn't match between code and prose
The code names three evidence levels; the statistics document explains the same
thresholds but never uses those three names, so a reader cannot connect them.
Fix: name the three levels explicitly in the statistics document.

### 8. Formatting has drifted in 84 files
84 files no longer match the project's own formatting standard, including six
documents and the settings and admin pages. Indentation and line wrapping are
inconsistent as a result.
Fix: run the project formatter once across everything. No behaviour changes.

### 9. Four pages are missing their social preview tags
Four of eight signed-in pages omit two preview tags that the other four include.
Fix: make all eight consistent.

## What protects this going forward

There is already an automated check that guards documentation claims, but it works
by pinning specific sentences that were wrong once before — it cannot notice a new
feature that nobody documented. That is exactly how problems 1 and 2 happened.

So the last step adds three new automated checks: every Admin panel file must
either be on the page or be gone; the markets named in the operations document
must match the live stage table; and every named Settings control must have a
help-centre entry. After that, this class of drift fails the build instead of
waiting for an audit.

## Technical notes

- New docs: `docs/EXECUTION-QUALITY.md`. Updated: `docs/EXECUTION.md`,
  `docs/OPERATIONS.md`, `docs/PERFORMANCE-AND-STATISTICS.md`,
  `docs/README.md` index, `README.md`, `roadmap.md`.
- Help centre: new sections in `src/routes/_authenticated/guide.tsx`
  (brakes/cooldowns, ceilings/webhook, MetaStats + Risk Guardian).
- Orphaned panels: `SymbolBindingPanel`, `CommissioningPanel`, `RefusalCostPanel`,
  `InstrumentDiagnosticsPanel`, `NewsPanel` — resolve against roadmap
  2026-09-03 notes; `PromotionPanel` is correctly mounted.
- `prettier --write` across `src/**` and `*.md` (84 files).
- `og:type` + `twitter:card` added to `auth.tsx`, `settings.tsx`, `feed.tsx`,
  `history.tsx`.
- Three new assertions in `src/test/__tests__/docs-contract.test.ts`.
- No source logic, no schema, no scanner, no execution-gate changes. Live
  execution and live auto-trading stay off.
