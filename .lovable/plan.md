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

- **N1** `src/routes/index.tsx:78` hardcodes "Twelve MCP tools"; the tool count is derivable from the registry. Same drift class as finding 7.
- **N2** `docs/PROMPT-14-VERIFICATION.md` contains corrupted text: "**Result: n.**" and "were n because PostgreSQL `initdb` is unavailable" — a bad find/replace ate "NOT RUN"/"skipped".
- **N3** `robots.txt` allows `/` for all agents while `/auth` is `noindex`; sitemap and robots disagree about `/auth`.
- **N4** `docs/README.md` reading order lists 22 entries but `docs/` has 25 files — CHARACTERISATION and DB-TESTS are listed as historical while LINK-AUDIT sits in the numbered canonical list.
- **N5** No test asserts sitemap contents against indexable routes, nor that every route's `head()` has title/description/og pairs — both drift classes are currently unguarded.
- **N6** `src/lib/mcp/tools/get-scanner-status.ts:24` and `get-my-settings.ts` return `timeframes` as part of "your active filters", which is the same untruth as finding 4 in assistant-visible text.

## 4. Remediation workstreams

Sequenced so the pipeline goes green first, then truth-in-copy, then structure.

**W1 — Make verification real (do first).** Run Prettier `--write` across the repo, fix the single `prefer-const`, and decide whether the 22 `react-refresh` warnings stay warnings (recommended: yes, they are template-shaped). Files: 67 formatting-only files plus `previewAuthStorage.ts`. Accept when `bun run verify` is green end to end and a fresh Actions run on the final commit passes. No behaviour change; rollback is trivial.

**W2 — Timeframes truth.** Recommended: **remove the timeframe selector from Settings and from MCP tool descriptions/schemas**, because a published signal *is* an H4+H1+M15 confluence read — a per-timeframe filter would misrepresent the model. Keep the column (no destructive migration), stop presenting it, and have `update_my_settings` reject the field with a clear reason rather than silently accepting it. Files: `settings.tsx`, `src/lib/mcp/settings-validation.ts`, `tools/update-my-settings.ts`, `tools/get-my-settings.ts`, `tools/get-scanner-status.ts`, `.lovable/mcp/manifest.json`, `docs/ALERTS-AND-ELIGIBILITY.md`, `docs/SCANNER.md`, `connect.tsx:43`. Test: an [INVARIANT] asserting no user-facing settings field is absent from `EligibilitySettings`.

**W3 — Homepage positioning.** Replace the strip item with the most precise statement the code supports: *"Alerts are notification-only — the alert path cannot place orders. Optional execution is a separate system: disabled globally by default, armed per account, dry-run first, and refused when any broker fact is missing."* Add a short "Connect a broker account" block naming Observe-first onboarding, demo vs live classification, the three evidence sources, and telemetry as monitoring. Keep no-advice/no-guarantee framing; add nothing about acceptance without acknowledgement. Files: `index.tsx`, `docs/PRODUCT.md`. Test: copy-contract assertions in the docs-contract suite.

**W4 — Auth CTA.** Add `mode` to `auth.tsx` `validateSearch` (only `"signup"` recognised, anything else falls back to sign-in), drive `Tabs value` from it, and switch title/heading per mode. Keep `safeNext` untouched, keep Google `redirect_uri` unchanged, preserve the confirmation-return path. Files: `index.tsx` CTAs, `auth.tsx`, new route test.

**W5 — Guide + PRODUCT coverage.** Add Guide questions for MetaStats and feature-availability flags, the processing/unavailable/refused telemetry states, Risk Guardian as *monitoring not a pre-submit safeguard*, drawdown breaches and missing figures, broker observation timestamps, event deduplication, and why absence of a breach proves nothing. Files: `guide.tsx`, `docs/PRODUCT.md`, cross-links to `docs/METASTATS.md`, `docs/RISK-GUARDIAN.md`.

**W6 — Documentation taxonomy.** Introduce three explicit types in `docs/README.md`: **feature reference** (bound by the ten-section contract), **vocabulary/index**, **historical & audit** (excluded). Move `PROMPT-14-VERIFICATION.md` to `docs/audits/2026-08-23-prompt-14.md`, retitle it as a dated snapshot, fix the corrupted "n" strings (N2), and keep the `NOT RUN` smoke record intact. Replace LINK-AUDIT's "18 documents" and any count with "every document listed in the canonical index resolves". Extend `docs-contract.test.ts` to enforce the contract on feature references only and to fail on any doc missing from the index.

**W7 — SEO/PWA/a11y.** Drop `/auth` from the sitemap, add `/connect`, give `/connect` a canonical link, delete the invalid `{ rel: "canonical" }` from `index.tsx`'s meta array, downgrade `/connect` to `twitter:card: summary` unless a real absolute `og:image` is added, wrap the landing content in `<main>`. Add tests asserting sitemap ⊆ indexable routes and head-metadata completeness (N5). Files: `sitemap[.]xml.ts`, `index.tsx`, `connect.tsx`, `public/robots.txt`.

**W8 — /connect registration copy + guidance.** Recommended: keep the endpoint, remove it from general user guidance. Lead with "create your account at /auth, then connect the assistant"; keep the endpoint documented as a *public HTTPS registration endpoint outside the authenticated MCP connection*, in a collapsed advanced note, with an explicit caution about sharing a password with an assistant. Files: `connect.tsx`, `docs/MCP.md`, `docs/SECURITY.md`. No endpoint code change in this pass.

**W9 — Repository hygiene.** Add `.env`, `.env.*`, `!.env.example` to `.gitignore`; add `.env.example` with key names only. Do **not** untrack `.env` until we confirm the platform build does not read the tracked file — untracking it blind risks breaking the deploy. No rotation, no history rewrite (evidence in finding 11). Never print values.

**W10 — Drift-proofing.** Derive the MCP tool count on the homepage from the registry (N1); prefer generated inventories over prose counts anywhere else.

## 5. File-by-file impact matrix

| Area | Files | Why | Validation |
|---|---|---|---|
| App code | `auth.tsx`, `index.tsx`, `settings.tsx`, `guide.tsx`, `connect.tsx`, `sitemap[.]xml.ts`, `previewAuthStorage.ts` | W1, W2, W3, W4, W5, W7 | typecheck, unit/route tests, build |
| MCP | `settings-validation.ts`, `tools/update-my-settings.ts`, `tools/get-my-settings.ts`, `tools/get-scanner-status.ts`, `.lovable/mcp/manifest.json` | W2 | manifest/registry parity test |
| Public copy | `index.tsx`, `connect.tsx` | W3, W8 | copy-contract tests |
| Docs | `docs/README.md`, `PRODUCT.md`, `LINK-AUDIT.md`, `SCANNER.md`, `ALERTS-AND-ELIGIBILITY.md`, `MCP.md`, `SECURITY.md`, new `docs/audits/…` | W2, W3, W5, W6, W8 | link + contract tests |
| Tests | `docs-contract.test.ts`, new eligibility/settings-parity, auth-route, sitemap/head tests | all | `bunx vitest run --project blocking` |
| Config/SEO | `.gitignore`, new `.env.example`, `public/robots.txt` | W7, W9 | secret scan, manual robots read |
| Formatting only | 67 Prettier files | W1 | `prettier --check` |
| Migrations | **none** | timeframes column retained | n/a |

## 6. Verification strategy

`prettier --check` → `bun run lint` (0 errors) → `bun run typecheck` → `bunx vitest run --project blocking` → DB suites where `initdb` exists → `bun run build` → docs link/contract tests → MCP manifest parity → unauthenticated smoke of `/`, `/auth`, `/auth?mode=signup`, `/connect`, `/sitemap.xml`, `/robots.txt` → sitemap/metadata assertions → eligibility unit checks for settings→feed/alert → execution-safety invariants unchanged (no gate enabled, no order sent, no broker call, no settings mutation) → secret scan → finally a green GitHub Actions run on the last commit. Remediation is not complete while CI is red.

## 7. Acceptance criteria

1. Clicking "Create an account" opens the registration tab, with a signup-specific title, working Google sign-in, and safe `next` preserved across refresh and confirmation return.
2. No user-facing or assistant-facing setting is presented as a filter unless it appears in `EligibilitySettings`; a test enforces this.
3. Homepage execution wording states notification-only alerts *and* separately gated, armed, dry-run-first optional execution, with no default-on or guarantee implication.
4. The Guide explains MetaStats, availability flags, all telemetry states, Risk Guardian's monitoring scope, drawdown breaches, missing figures, deduplication and the "no breach ≠ no risk" limit.
5. Dated verification evidence lives in an audit directory, is titled as a snapshot, retains `NOT RUN`, and no canonical doc implies broker execution has been smoke-tested.
6. `/sitemap.xml` contains only indexable public routes; `/auth` absent, `/connect` present with canonical; no `summary_large_image` without an image; landing has one `<main>`.
7. `.gitignore` blocks future `.env*`; `.env.example` documents key names; no secret value appears in code, tests, docs or messages.
8. No documentation states a numeric document, test or tool count that development will drift.
9. `bun run verify` and GitHub Actions are green on the final commit.

## 8. Risks and open decisions

| Decision | Recommendation |
|---|---|
| Timeframes: remove vs implement | **Remove from UI/MCP, keep the column.** A per-timeframe filter would misdescribe a confluence signal. |
| Execution prominence on the homepage | **One qualified strip item plus a short broker-accounts block** — visible, never marketed as live trading. |
| Agent-led password registration | **Keep the endpoint, remove it from general guidance**; prefer self-service `/auth`. A one-time signup token is the better long-term design — separate workstream. |
| Dated verification in canonical docs | **Move to `docs/audits/`** and replace with a repeatable procedure. |
| MetaStats / Risk Guardian on the homepage | **Guide + PRODUCT.md primary**; one homepage sentence only. |
| `/connect` indexed? | **Yes, index it** with a canonical — it is a legitimate acquisition page. |
| Untracking `.env` | **Defer** pending confirmation the platform build does not consume it. |

## 9. Readiness verdict

- **Mechanical:** W1 formatting + `prefer-const`, W7 SEO fixes, W6 count/typo fixes, W9 `.gitignore`, W10.
- **Product decisions needed:** timeframes removal, homepage execution prominence, `/connect` registration guidance, MetaStats/Guardian placement.
- **Security review:** W8 guidance change; W9 untracking decision (no rotation required).
- **Migrations:** none.
- **Authenticated testing:** W2 Settings round-trip, W5 Guide rendering.
- **Broker-authorised smoke:** still out of scope; demo-order smoke stays `NOT RUN`.

The plan is ready to implement once the four product decisions in section 8 are confirmed. Nothing here expands execution permissions, enables a gate, touches broker systems, or introduces invented data.
