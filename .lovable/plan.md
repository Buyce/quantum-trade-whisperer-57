# Documentation, Comprehension & Source-Quality Release

No trading behaviour changes. Scanner maths, grading, replay, R maths, eligibility,
sizing, execution state machine, RLS and MetaApi call volume stay byte-identical.
Only docs, copy, UI comprehension layers, comments and formatting change.

## What exists today (audited at current HEAD)

- `README.md` is still the original build prompt, and it contains a live MetaApi
  account ID, login number and user ID in plain text. It also points at a
  `*.lovable.app` preview URL as the app link.
- `/docs` has only `CHARACTERISATION.md` and `DB-TESTS.md`; both describe the V1
  test ledger, not the product.
- `AGENTS.md` still instructs that any empty feed must render "Capital
  Preservation Mode Active" — the code and the MCP invariant tests already
  distinguish a filtered empty view from a genuine no-trade day, so the doc is
  stale.
- The homepage lists 10 feature cards, including "Verified trade journal" and
  "Bayesian learning" phrasing that overstates provenance and predictiveness.
- `GuideMode.tsx` provides only a provider, a toggle and a one-line `InfoLabel`
  tooltip. There is no in-app Guide/Help page anywhere.
- 51 test files; scripts are `bun run dev` / `test` / `verify` (lint:blocking +
  typecheck + test + build). Exact counts get read from a real run, not memory.

## Phase A — Audit matrix (no edits)

Build an internal table of every user-facing claim vs. its code evidence, across
README, docs, homepage, Connect AI, Settings, onboarding, empty states, Signal
Card, Feed, History, Performance, MCP tool descriptions, manifest, robots,
sitemap. Flag every use of verified / broker / live / estimate / risk / R /
expectancy / win rate / confidence / Bayesian / bootstrap / significance /
shadow / research / daily cap / self-reported / agent.

## Phase B — README rebuild

Replace entirely: description, current production scope derived from code
constants, Mermaid architecture diagram (MetaApi → cron → queue/workers →
scanner → `scanned_signals` → feed/alerts, journal, research/shadow, statistics,
execution queue), safety philosophy, data-provenance table, testing section with
real counts, local dev with bun, `https://getptrades.com` as canonical URL, docs
index, disclaimer. All hardcoded MetaApi credentials/IDs removed and replaced by
environment-variable names only — nowhere re-introduced in examples.

## Phase C — Documentation tree

Create `docs/README.md`, `PRODUCT.md`, `ARCHITECTURE.md`, `SCANNER.md`,
`SIGNALS-AND-GRADES.md`, `RISK-SIZING.md`, `JOURNAL-AND-R.md`,
`PERFORMANCE-AND-STATISTICS.md`, `RESEARCH-AND-SHADOW.md`,
`ALERTS-AND-ELIGIBILITY.md`, `EXECUTION.md`, `MCP.md`, `SECURITY.md`,
`OPERATIONS.md`, `TESTING.md`, `DATA-PROVENANCE.md`, `GLOSSARY.md`. Each states
purpose, current behaviour, inputs, outputs, provenance, failure behaviour,
user-facing meaning, explicit non-guarantees, implementation files and tests.

Update in place (not rewrite): `CHARACTERISATION.md` and `DB-TESTS.md` get a
"historical V1 ledger vs. current truth" header plus corrected counts/paths;
`src/routes/README.md` and `AGENTS.md` get corrected statements, including the
Capital-Preservation nuance (unfiltered zero = no-trade day; filtered zero =
neutral "no setups match this view"). `.lovable/plan/**` is left untouched.

## Phase D — Link audit

Verify every internal and external link. External MCP-client setup steps
(ChatGPT, Claude, Claude Code, other clients) are checked against current vendor
documentation via web research before any wording change; unstable deep links
fall back to the stable official page plus accurate UI steps. Stale Lovable
production URLs removed. A link-validation test covers internal doc/app links.

## Phase E — In-app Guide / Help route

New `/guide` route (authenticated shell, reached via the existing Guide control
so the 5-item mobile nav is not extended). Anchored sidebar navigation +
collapsible sections + search-by-heading. Sections: Getting started,
Understanding a signal, Risk, Journal, Performance, Research/statistics, Alerts,
AI assistants, Execution. Uses "What this means / Why it matters / What you
should do / What P-Trades cannot know" callouts, short diagrams, and clearly
labelled `Educational example — not live market data` numbers that never appear
in the feed.

## Phase F — Guide Mode depth

Extend `GuideMode.tsx` with a richer disclosure component (what it is / why it
matters / how to interpret / what not to assume + "Learn more →" deep link into
`/guide`). Apply to Feed, Signal Card, History, Performance, Settings, push and
email controls, risk sizing, AI connection and delivery history. Progressive
disclosure only — no permanent paragraphs on labels.

## Phase G — Empty and error states

Every major empty/error state answers what happened, whether anything is broken,
and what to do next: no signals (filtered vs. genuine no-trade), no personal
performance, no lot size (naming the exact missing or stale input), delivery
unknown state. Generic "Something went wrong" replaced wherever a precise cause
is available.

## Phase H — Homepage simplification

Rebuild `src/routes/index.tsx` to: hero (selective assistant that also tells you
when there is no trade) + Open terminal / How it works, three steps (Scan, Plan,
Measure), one compact methodology strip (deterministic rules, explicit
provenance, no forced trades, no fabricated setups, dry-run-first execution),
final CTA, footer linking Guide, AI connection, docs, disclaimer. Removes
"verified journal", confidence-as-probability, broker-exact margin and
live-execution implications; PineConnector stays described as dry-run only.

## Phase I — Metadata

Correct titles, meta and OG descriptions on every route, PWA manifest
description and shortcuts, robots and sitemap, with `https://getptrades.com`
canonical. `/guide` is authenticated, so it stays out of the sitemap and is
marked noindex.

## Phase J — Source readability

Run the project's Prettier/ESLint over maintained TS/TSX/CSS/MD/config, excluding
lock files, `src/routeTree.gen.ts`, generated Supabase types, assets, historical
plans and migrations. Formatting is committed separately from copy changes. Add
module-level docblocks (owns / does not own / inputs / outputs / invariants /
failure behaviour) and high-value comments on financial formulas, provenance,
fail-closed choices, state machines, idempotency, SSRF, auth assumptions, broker
budgets, daily-cap and UTC-day semantics, retention, statistics and
research/production boundaries. No comments restating syntax.

## Phase K — Terminology map + contract tests

A canonical terminology table in `GLOSSARY.md`, applied across UI, comments and
docs; "verified" is never used without naming what was verified and by what. New
semantic tests: canonical URL present, no credential/account-ID patterns in docs,
no stale preview URL as production, internal links resolve, Connect AI tool names
match `.lovable/mcp/manifest.json`, docs never equate empty `list_signals` with
"no valid setup", never call self-reported prices broker-verified, never call
margin broker-exact, execution-policy name matches the code constant, and
documented instruments/timeframes are asserted against `src/lib/scanner/types.ts`.

## Phase L — Responsive + validation

Check every changed screen at ~360px, ~768px, desktop and wide: no horizontal
overflow, touch-usable tooltips, mobile-usable Guide navigation, wrapping error
strings, clear CTA hierarchy, uncrowded AppShell. Then a second factual red-team
pass over every remaining claim, followed by `bun run typecheck`, `bun run test`,
`bun run verify`, `bun run build`, plus repo-wide lint/format reported
separately. No lint rule is weakened.

## Stopping rule

If documentation exposes a possible trading, maths or security defect, it is
recorded in the final report — not silently fixed. Prompts 7–13 remain the
behavioural baseline, and no further product prompt is started.

## Delivery report

HEAD audited, docs found before, stale claims found, docs created/updated,
screens updated, links checked/changed, homepage IA before/after, Guide Mode
coverage before/after, files formatted, files with material comments added,
generated files excluded, security-sensitive content removed, test additions,
exact final test count, verify result, lint/format result, build result, final
SHA, remaining documentation/UX debt.
