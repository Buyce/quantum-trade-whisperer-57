# Audit & Feasibility Report — Beginner-Friendly UX Layer

## 1. Quantitative engine safeguard

Confirmed: every proposed enhancement is presentational. None of the scanner files are read or written by UI components.

- `src/lib/scanner/grading.ts`, `indicators.ts`, `metaapi.server.ts`, `pipeline.server.ts`, `profile.ts` — untouched.
- No migration, no enum change, no RLS change (one optional exception, see §2c).
- The feed already receives fully computed rows (`SignalRow`), so tooltips and copy buttons only reformat values that are already on screen.

## 2. Component & layout audit

### a. Header placement for the Guide Mode toggle
`src/components/AppShell.tsx` header is a single 56px row: logo, nav links (Signal Feed / Performance / Settings), then `ml-auto` with the Sign out button. The clean slot is inside that right-hand group, immediately left of Sign out: a ghost icon button with a `HelpCircle` icon plus a `hidden sm:inline` "Guide" label — identical styling to Sign out, so the terminal aesthetic is unchanged and mobile collapses to icon-only. Active state shown by `bg-secondary text-foreground`, matching the existing nav-active treatment.

State lives in a small `GuideModeProvider` context in `src/components/GuideMode.tsx` (localStorage-backed, default ON for new users), consumed by feed and performance. Note: `TooltipProvider` is currently only mounted inside `ui/sidebar.tsx`, so it must be mounted once in `src/routes/__root.tsx` for tooltips to work app-wide.

### b. SignalCard compatibility
`SignalCard.tsx` has a footer action row (`border-t ... px-4 py-3`) that already holds Log as Taken / Log as Skipped plus a right-aligned disclaimer. Adding "Copy order details" as a third `variant="outline" size="sm"` button in that existing flex-wrap row adds zero height on desktop and wraps naturally on mobile — no new section.

Execution badges: the current direction chip renders `LONG` / `SHORT`. It becomes `BUY LIMIT (LONG)` / `SELL LIMIT (SHORT)` in Guide Mode only, and stays `LONG` / `SHORT` when Guide Mode is off, so the pro layout is untouched. The chip is already inside a `flex-wrap` header, so the longer label wraps rather than overflowing.

Tooltips attach to existing labels (Entry, Stop-loss, TP1–3, R:R, Confidence, the four pillars) via a small `<InfoLabel>` wrapper that renders a plain label when Guide Mode is off — no extra DOM in pro mode.

### c. Onboarding persistence
Recommendation: `localStorage` key `ptrades.onboarding.dismissed`, read in `useEffect` (not in a `useState` initializer) to avoid a hydration mismatch. Reasons:
- `scanner_settings` is per-user but has no boolean for this; adding a column means a migration plus a schema-type regeneration, and the directive is zero schema change.
- The banner is a one-time nicety; a per-device flag is acceptable and has no network cost.

If you want it to follow the account across devices, the alternative is one nullable `onboarding_completed boolean default false` column on `scanner_settings` (existing RLS already scopes rows to the owner). Say the word and I'll include it; otherwise localStorage.

## 3. Risks, questions and alternatives

- Clutter risk: adding tooltip icons to every metric would visually noise the data grid. Mitigation above: tooltips render only in Guide Mode, and use an underline-dotted label rather than a `[?]` icon per cell.
- The feed's empty state already reads "NO TRADE — this is the system default, not an error", which is close to the requested reassuring copy. Proposal: keep the block, extend it in Guide Mode with one line explaining that waiting is expected and roughly how often setups appear.
- Copy format: default is a plain multi-line block (Instrument, order type, entry, SL, TP1–3, R:R, confidence). Question below on whether you want an MT5-friendly single line instead.

## Implementation scope (on approval)

Files touched, all client-side:
- new `src/components/GuideMode.tsx` (context + toggle + `InfoLabel`)
- new `src/components/OnboardingBanner.tsx`
- `src/components/AppShell.tsx` (toggle in header)
- `src/components/SignalCard.tsx` (copy button, execution badges, tooltips)
- `src/routes/_authenticated/feed.tsx` (banner, richer empty state)
- `src/routes/_authenticated/performance.tsx` (metric tooltips)
- `src/routes/__root.tsx` (mount `TooltipProvider`)
