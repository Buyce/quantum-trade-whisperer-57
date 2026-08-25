# Documentation & Product-Copy Remediation — Independent Audit + Plan

Audited at HEAD `11f167c` ("Fixed settings reload bug"). Everything below was checked against the working tree; I ran the read-only parts of `verify` myself.

## 1. Executive assessment

**Mostly aligned, with two areas that are materially behind the product and one broken user path.**

- The engine claims hold up: three instruments, H4/H1/M15, 15-minute cadence, A+/A/B/C, confidence as rule satisfaction, cap 0 = unlimited, C never consumes cap, separate feed/alert thresholds, fail-closed sizing, margin labelled an estimate, 12 MCP tools (12 tool files, 12 manifest entries).
- Materially behind: the homepage execution strip ("Notifications, not orders") and the in-app Guide (no MetaStats / Risk Guardian / telemetry-state coverage).
- Broken path: "Create an account" lands on the Sign-in tab.
- Not verified: CI is red on lint. Typecheck and the blocking suite actually pass locally (1012 tests, 85 files), but the pipeline never reaches them, so the repo cannot be called verified.
- Nothing found that is unsafe or that overstates trading outcomes. No fabricated market data. No secret exposure.

## 2. Independent evidence table

| # | Verdict | Evidence | Root cause | Impact | Sev | Conf |
|---|---|---|---|---|---|---|
| 1 CI red | **Confirmed, with correction** | `bun run lint` → exactly `81 problems (59 errors, 22 warnings)`; `prettier --check` → 67 files. 58/59 errors auto-fixable; the one real error is `prefer-const` on `let timer` (`src/integrations/supabase/previewAuthStorage.ts:38`). Correction: typecheck exits 0 and blocking tests pass 1012/1012 locally — the reported figures were right but "tests unknown" is now resolved; DB suites skip without `initdb`. | `verify` runs lint first; formatting drift never committed | No user impact; release cannot be called verified | High (process) | High |
| 2 Homepage positioning | **Confirmed** | `src/routes/index.tsx:66` "Notifications, not orders … alert path cannot send broker instructions at all". Product supports Observe / Demo auto / Live-on-confirm / Live auto (`src/lib/accounts/**`, `src/lib/delivery/direct-enqueue.server.ts`), plus the JSON bridge. | Copy written before Prompt 14 execution work | Visitors conclude orders are impossible; connected-account features invisible | High | High |
| 3 Create-account CTA | **Confirmed** | `index.tsx:155,219` → `/auth`; `auth.tsx` `validateSearch` accepts only `next`, `Tabs defaultValue="signin"`, title "Sign in — P-Trades Hub" | No signup entry state | Sign-up friction on the primary conversion path | High | High |
| 4 Timeframes inert | **Confirmed** | Column exists (`…b0570e3d….sql:102`), read/written by Settings (`settings.tsx:207,278`) and MCP (`update-my-settings.ts:13`), but `src/lib/delivery/eligibility.ts` filters only instrument, session, grade, retention, cap — `timeframes` appears nowhere in delivery, feed, alerts, day-frame or execution. | Setting predates the multi-timeframe signal model | Users believe an inactive filter is active; MCP repeats it | Med-High | High |
| 5 Guide gaps | **Confirmed** | No occurrence of MetaStats, Risk Guardian, drawdown, deduplication or telemetry states in `guide.tsx` / `GuideMode.tsx`, while `docs/METASTATS.md`, `docs/RISK-GUARDIAN.md` and `accounts.tsx` surface them | Guide not extended with Prompt 14 | Users can't interpret telemetry states; may read "no breach" as "no risk" | Med-High | High |
| 6 Prompt-14 doc too strong | **Confirmed** | `docs/PROMPT-14-VERIFICATION.md` is a dated 2026-08-23 snapshot with test/lint figures, listed in `docs/README.md` as canonical-for-HEAD item 21; demo smoke still `NOT RUN` | Snapshot filed as canonical reference | Stale figures readable as current release status | Med | High |
| 7 Stale doc count | **Confirmed** | `docs/LINK-AUDIT.md:33` says "all 18 documents"; `docs/` holds 25 `.md` files | Hardcoded count | Documentation self-contradiction | Low-Med | High |
| 8 Doc contract overstated | **Confirmed** | `docs/README.md:55` claims all ten sections everywhere; BROKER-ACCOUNTS, BROKER-EVIDENCE, METASTATS, RISK-GUARDIAN, LINK-AUDIT, CHARACTERISATION, GLOSSARY, DB-TESTS, PROMPT-14 each miss several. `docs-contract.test.ts` does not enforce it. | Contract written as universal, applies only to feature refs | Contract is unenforceable and untrue | Med | High |
| 9 /connect registration | **Partially confirmed** | `connect.tsx:226` "HTTP endpoint" (site is HTTPS); `:144` example posts `email` + `password`. Correction: the endpoint itself is defensible — Zod validation, publishable-key `signUp` (email confirmation required), hashed per-IP/per-email counters, generic errors, no body logging. The problem is copy plus the *pattern* of teaching users to hand a password to an assistant. | Wording + guidance choice, not an implementation hole | Password-sharing habit; misleading transport wording | Med (copy High) | High |
| 10 SEO/social | **Confirmed** | Sitemap lists `/auth` which is `robots: noindex` (`auth.tsx:27`); `/connect` absent and has no canonical; `index.tsx` head has an invalid `{ rel: "canonical" }` **inside `meta`** alongside the correct `links` entry; `connect.tsx` declares `twitter:card: summary_large_image` with no image; no `og:image`/`twitter:image` anywhere; no `<main>` landmark in `index.tsx` | Head assembled by hand | Contradictory crawl signals, blank social previews, a11y landmark gap | Med | High |
| 11 Tracked `.env` | **Partially confirmed** | `.env` is tracked; `.gitignore` has no env pattern. Correction: the tracked keys are exclusively browser-publishable (`*_PROJECT_ID`, `*_PUBLISHABLE_KEY`, `*_URL`); history shows one commit and no secret-shaped additions, so **no rotation and no history rewrite are needed**. | Missing ignore patterns | No current exposure; future secrets could be committed silently | Med (preventive) | High |

## 3. Newly discovered issues

- **N1** `src/routes/index.tsx:78` hardcodes "Twelve MCP tools" in marketing copy. The homepage must **not** import or dynamically couple to the server MCP registry; either drop the number from the copy or pin it with a contract test.
- **N2** *Withdrawn.* My initial reading of corrupted "NOT RUN" text in `docs/PROMPT-14-VERIFICATION.md` was a tooling error on my side (a ripgrep `-r` replace flag). `git status` shows the file unmodified and lines 14, 47 and 64 contain the correct `NOT RUN` wording. No defect.
- **N3** *Corrected.* `robots.txt` allowing `/auth` is fully compatible with page-level `noindex` — a crawler must be allowed to fetch the page to read the directive. The only real issue is the **sitemap** advertising a `noindex` URL. Remove `/auth` from the sitemap; leave `robots.txt` unchanged.
- **N4** `docs/README.md` reading order lists 22 entries but `docs/` has 25 files — CHARACTERISATION and DB-TESTS are listed as historical while LINK-AUDIT sits in the numbered canonical list.
- **N5** No test asserts sitemap contents against indexable routes, nor that public indexable routes carry complete head metadata — both drift classes are currently unguarded.
- **N6** `src/lib/mcp/tools/get-scanner-status.ts:24` and `get-my-settings.ts` return `timeframes` as part of "your active filters", which is the same untruth as finding 4 in assistant-visible text.


## 4. Remediation workstreams

Sequenced so the pipeline goes green first, then truth-in-copy, then structure.

**W1 — Make verification real (do first).** Run Prettier `--write` across the repo, fix the single `prefer-const`, and decide whether the 22 `react-refresh` warnings stay warnings (recommended: yes, they are template-shaped). Files: 67 formatting-only files plus `previewAuthStorage.ts`. Accept when `bun run verify` is green end to end and a fresh Actions run on the final commit passes. No behaviour change; rollback is trivial.

**W2 — Timeframes deprecation (explicit strategy, no silent acceptance).** A published signal *is* an H4+H1+M15 confluence read, so a per-timeframe filter would misdescribe the model. Deprecate rather than reinterpret, in four defined steps:

1. **UI:** remove the "Timeframes of interest" selector from Settings; replace it with a static, non-interactive line stating that every setup is graded across H4, H1 and M15 together.
2. **Write path:** `update_my_settings` stops accepting `timeframes`. It must **not** silently ignore it — the field is rejected with an explicit `deprecated_field` warning naming the reason ("timeframes is not a filter; every setup uses H4, H1 and M15") while the rest of the patch still applies. Rejection is surfaced in the tool result, not swallowed.
3. **Read path:** `get_my_settings` and `get_scanner_status` stop returning `timeframes` and stop describing it as an active filter. Same for the `.lovable/mcp/manifest.json` descriptions and `connect.tsx:43`.
4. **Database:** the column and its default are retained — no destructive migration, no data loss, existing rows stay readable. It becomes a dormant column documented as deprecated in `docs/ALERTS-AND-ELIGIBILITY.md`. A drop is a separate, later decision once no code reads it.

Files: `settings.tsx`, `src/lib/mcp/settings-validation.ts`, `tools/update-my-settings.ts`, `tools/get-my-settings.ts`, `tools/get-scanner-status.ts`, `.lovable/mcp/manifest.json`, `connect.tsx`, `docs/ALERTS-AND-ELIGIBILITY.md`, `docs/SCANNER.md`. Tests: an [INVARIANT] asserting every user-facing/assistant-facing filter field appears in `EligibilitySettings`, plus a unit test asserting a `timeframes` patch produces a deprecation warning and no write.

**W3 — Homepage positioning (gate-state-independent wording).** The copy must stay true whether or not a global gate is ever enabled, so it describes the *architecture*, not the current switch position: *"Alerts are notification-only — the notification path cannot place broker orders. Execution is a separate, independently gated system: it must be explicitly armed per account, starts dry-run, and refuses whenever a required broker fact is missing or stale."* No claim that live execution is "off by default" or "globally disabled" — those are runtime states that could change and would silently make the page false. Add a short "Connect a broker account" block naming Observe-first onboarding, demo vs live classification, the three separate evidence sources, and telemetry as monitoring only. Keep no-advice/no-guarantee framing; never imply an order was accepted without acknowledgement, nor that every account qualifies for every mode. Files: `index.tsx`, `docs/PRODUCT.md`. Test: copy-contract assertions that the page contains no gate-state claim and no guarantee language.

**W4 — Auth CTA.** Add `mode` to `auth.tsx` `validateSearch` (only `"signup"` recognised, anything else falls back to sign-in), drive `Tabs value` from it, and switch title/heading per mode. Keep `safeNext` untouched, keep Google `redirect_uri` unchanged, preserve the confirmation-return path. Files: `index.tsx` CTAs, `auth.tsx`, new route test.

**W5 — Guide + PRODUCT coverage.** Add Guide questions for MetaStats and feature-availability flags, the processing/unavailable/refused telemetry states, Risk Guardian as *monitoring not a pre-submit safeguard*, drawdown breaches and missing figures, broker observation timestamps, event deduplication, and why absence of a breach proves nothing. Files: `guide.tsx`, `docs/PRODUCT.md`, cross-links to `docs/METASTATS.md`, `docs/RISK-GUARDIAN.md`.

**W6 — Documentation taxonomy and the audit move.** Introduce three explicit types in `docs/README.md`: **feature reference** (bound by the ten-section contract), **vocabulary/index**, and **dated audit & historical record** (explicitly excluded from that contract). `PROMPT-14-VERIFICATION.md` is factually correct as written — its only problem is placement and framing — so move it verbatim to `docs/audits/2026-08-23-prompt-14.md`, retitle it as a dated snapshot of that checkout, and keep the `NOT RUN` smoke record and all figures intact. The move requires, in the same change:

- **Recursive link validation.** `docs-contract.test.ts` currently walks `docs/*.md`; it must walk `docs/**` so `docs/audits/` is covered, and resolve relative links from each file's own directory (a `../src/...` path in an audit file must validate correctly).
- **Reference updates.** Update every inbound reference: `docs/README.md` item 21, `docs/LINK-AUDIT.md`, and any other doc or code comment naming the old path. A test asserting no doc references a nonexistent sibling path will catch misses.
- **Contract exclusion by directory.** The ten-section contract applies to feature references only; `docs/audits/**`, `CHARACTERISATION.md`, `DB-TESTS.md`, `GLOSSARY.md`, `LINK-AUDIT.md` and `README.md` are declared exceptions in one list the test reads, so the taxonomy is enforced rather than described.

Also replace LINK-AUDIT's "all 18 documents" with "every document listed in the canonical index resolves" — no replacement number.

**W7 — SEO/social/a11y, scoped to public indexable routes.** Complete metadata (title, description, `og:title`, `og:description`, `og:type`, `og:url`, canonical, `twitter:card`) is required **only** for public indexable routes — currently `/` and `/connect`. `/auth` stays `noindex` and is explicitly exempt; authenticated routes under `_authenticated` are out of scope entirely. Changes: drop `/auth` from the sitemap (leave `robots.txt` untouched — see N3), add `/connect` to the sitemap, give `/connect` a self-referencing canonical and `og:url`, add `og:url` to `/`, delete the invalid `{ rel: "canonical" }` object from `index.tsx`'s `meta` array (the `links` entry is already correct), downgrade `/connect` to `twitter:card: summary` unless the owner approves generating a real absolute `og:image`, and wrap the landing content in a single `<main>` landmark. Tests: sitemap ⊆ public indexable routes, and a metadata-completeness assertion that iterates the indexable-route list only. Files: `sitemap[.]xml.ts`, `index.tsx`, `connect.tsx`.

**W8 — /connect registration copy + guidance.** Recommended: keep the endpoint, remove it from general user guidance. Lead with "create your account at /auth, then connect the assistant"; keep the endpoint documented as a *public HTTPS registration endpoint outside the authenticated MCP connection*, in a collapsed advanced note, with an explicit caution about sharing a password with an assistant. Files: `connect.tsx`, `docs/MCP.md`, `docs/SECURITY.md`. No endpoint code change in this pass.

**W9 — Repository hygiene, decided by verification not deferral.** Sequence: (1) confirm how production gets its configuration — inspect the platform build/deploy configuration and confirm `VITE_SUPABASE_*` are injected as environment variables at build time rather than read from the tracked file; (2) if injection is confirmed, **untrack `.env`** (`git rm --cached`, file kept locally) and add `.env`, `.env.*`, `!.env.example` to `.gitignore` plus a committed `.env.example` carrying key names and no values; (3) if the tracked file turns out to be load-bearing for the platform build, keep exactly that one file tracked, add the ignore patterns anyway so no *other* env file can ever be committed, and record the reason in `docs/SECURITY.md`. Either way the outcome is a decision with evidence, not an open item. No rotation and no history rewrite — the tracked keys are browser-publishable only and history shows no secret-shaped values. Never print values in code, tests, logs, docs or commit messages.

**W10 — Drift-proofing without coupling.** Do **not** import the server MCP registry into the public homepage — that would pull server-side module graph into a public bundle for a marketing string. Choose one: (a) reword the copy so no number appears ("a full MCP tool set for ChatGPT, Claude and Claude Code"), or (b) keep the literal "Twelve" and pin it with a contract test asserting the homepage number equals the registry's tool count, with the test — not the page — doing the import. Recommendation: **(b)**, since the count is a genuinely useful concrete claim. Apply the same rule everywhere else: prose counts are allowed only when a test pins them.

## 5. File-by-file impact matrix

| Area | Files | Why | Validation |
|---|---|---|---|
| App code | `auth.tsx`, `index.tsx`, `settings.tsx`, `guide.tsx`, `connect.tsx`, `sitemap[.]xml.ts`, `previewAuthStorage.ts` | W1, W2, W3, W4, W5, W7 | typecheck, unit/route tests, build |
| MCP | `settings-validation.ts`, `tools/update-my-settings.ts`, `tools/get-my-settings.ts`, `tools/get-scanner-status.ts`, `.lovable/mcp/manifest.json` | W2 | manifest/registry parity test |
| Public copy | `index.tsx`, `connect.tsx` | W3, W8 | copy-contract tests |
| Docs | `docs/README.md`, `PRODUCT.md`, `LINK-AUDIT.md`, `SCANNER.md`, `ALERTS-AND-ELIGIBILITY.md`, `MCP.md`, `SECURITY.md`, new `docs/audits/…` | W2, W3, W5, W6, W8 | link + contract tests |
| Tests | `docs-contract.test.ts`, new eligibility/settings-parity, auth-route, sitemap/head tests | all | `bunx vitest run --project blocking` |
| Config/secrets | `.gitignore`, new `.env.example`, `.env` untracked if injection confirmed (W9) | W9 | secret scan; production build reads injected env |
| Formatting only | 67 Prettier files | W1 | `prettier --check` |
| Migrations | **none** | timeframes column retained | n/a |

## 6. Verification strategy

`prettier --check` → `bun run lint` (0 errors) → `bun run typecheck` → `bunx vitest run --project blocking` → DB suites where `initdb` exists → `bun run build` → docs link/contract tests → MCP manifest parity → unauthenticated smoke of `/`, `/auth`, `/auth?mode=signup`, `/connect`, `/sitemap.xml`, `/robots.txt` → sitemap/metadata assertions → eligibility unit checks for settings→feed/alert → execution-safety invariants unchanged (no gate enabled, no order sent, no broker call, no settings mutation) → secret scan → finally a green GitHub Actions run on the last commit. Remediation is not complete while CI is red.

## 7. Acceptance criteria

1. Clicking "Create an account" opens the registration tab, with a signup-specific title, working Google sign-in, and safe `next` preserved across refresh and confirmation return.
2. No user-facing or assistant-facing setting is presented as a filter unless it appears in `EligibilitySettings`; a test enforces this, and a `timeframes` patch returns an explicit deprecation warning rather than being silently accepted or silently dropped.
3. Homepage execution wording is true independently of any runtime gate state: notification-only alerts, execution as a separately gated, explicitly armed, dry-run-first system that refuses on missing broker facts — with no "off by default" claim, no guarantee, and no implication that every account qualifies for every mode.
4. The Guide explains MetaStats, availability flags, all telemetry states, Risk Guardian's monitoring scope, drawdown breaches, missing figures, deduplication and the "no breach ≠ no risk" limit.
5. Dated verification evidence lives under `docs/audits/`, is titled as a dated snapshot, retains `NOT RUN` verbatim, is excluded from the feature-reference contract, and every inbound reference resolves under recursive link validation.
6. `/sitemap.xml` lists only public indexable routes (`/` and `/connect`); `/auth` is absent from the sitemap and still reachable in `robots.txt`; `/connect` has a self-referencing canonical; no `summary_large_image` is declared without an image; the landing page has exactly one `<main>`.
7. `.gitignore` blocks every future `.env*`; `.env.example` documents key names only; the tracked-`.env` question is closed with a recorded decision; no secret value appears anywhere.
8. Every numeric claim in copy or documentation is either removed or pinned by a test; no page imports the server MCP registry.
9. `bun run verify` and GitHub Actions are green on the final commit.

## 8. Risks and open decisions

| Decision | Recommendation |
|---|---|
| Timeframes: remove vs implement | **Deprecate per W2** — remove from UI/MCP with an explicit rejection warning, retain the dormant column. A per-timeframe filter would misdescribe a confluence signal. |
| Execution prominence on the homepage | **One architecture-level strip item plus a short broker-accounts block** — visible, gate-state-independent, never marketed as live trading. |
| Agent-led password registration | **Keep the endpoint, remove it from general guidance**; prefer self-service `/auth`. A one-time signup token is the better long-term design — separate workstream. |
| Dated verification in canonical docs | **Move to `docs/audits/` verbatim**, with recursive link validation and contract exclusion. |
| MetaStats / Risk Guardian on the homepage | **Guide + PRODUCT.md primary**; one homepage sentence only. |
| `/connect` indexed? | **Yes, index it** with a self-referencing canonical — it is a legitimate acquisition page. |
| Tracked `.env` | **Verify then act (W9):** confirm production env injection, then untrack; only keep it tracked if the platform build provably needs it. |
| Homepage MCP tool count | **Keep "Twelve", pin it with a contract test** — the test imports the registry, the page never does. |

## 9. Readiness verdict

- **Mechanical:** W1 formatting + `prefer-const`, W7 SEO fixes, W6 count/typo fixes, W9 `.gitignore`, W10.
- **Product decisions needed:** timeframes removal, homepage execution prominence, `/connect` registration guidance, MetaStats/Guardian placement.
- **Security review:** W8 guidance change; W9 untracking decision (no rotation required).
- **Migrations:** none.
- **Authenticated testing:** W2 Settings round-trip, W5 Guide rendering.
- **Broker-authorised smoke:** still out of scope; demo-order smoke stays `NOT RUN`.

The plan is ready to implement once the four product decisions in section 8 are confirmed. Nothing here expands execution permissions, enables a gate, touches broker systems, or introduces invented data.
