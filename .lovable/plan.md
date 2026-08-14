# Mobile & Tablet Readability Fix

The terminal was laid out desktop-first. On a 393px phone the header wraps into three
lines, the signal card's badge row overflows sideways so the instrument name and the
live-distance chip get clipped, and the key numbers (R:R, Conf, Entry, age) are squeezed
into one line of muted 12px text. Nothing is broken functionally — it is purely layout
and presentation. No scanner, query, or data logic changes.

## 1. App header (`src/components/AppShell.tsx`)

- Keep the logo mark, but hide the "P-TRADES HUB" wordmark below `sm` so the brand block
  stops wrapping to three lines; the mark alone identifies the app on phones.
- Give the nav its own row on mobile: brand + guide/sign-out on the top bar, then a
  full-width icon nav row underneath with evenly distributed touch targets (min 44px tall).
- On `sm` and up the current single-row layout stays exactly as it is today.

## 2. Signal card summary row (`src/components/SignalCard.tsx`)

This is where information is actually lost. Restructure the collapsed summary for mobile:

- Line 1: instrument (never truncated, larger and bolder) + grade badge + LONG/SHORT +
  chevron pinned right.
- Line 2: BUY/SELL LIMIT badge, CAPPED badge and the live distance chip, wrapping instead
  of overflowing (`flex-wrap`, no forced `shrink-0` on the distance chip; shorten its
  mobile copy to e.g. "Ran past entry · 12.4 pips" and keep the long phrasing from `sm`).
- Line 3: R:R, Conf, Entry and age as a 2x2 labelled mini-grid with the values at normal
  foreground size, so they read as data instead of fine print. Reverts to the current
  single inline row at `sm`.
- Detail metric grid: 2 columns on phones stays, but each cell gets more vertical padding
  and the label wraps rather than clipping.
- Detail body: confidence/pillars block already stacks; add horizontal scroll guard so
  long qualitative text never pushes the card wide.

## 3. Action bar (`src/components/SignalCard.tsx`)

- On mobile make the three primary actions full-width-ish stacked/2-up buttons with
  larger tap height, instead of three wrapped small buttons.
- Close-at R buttons (+1R/+2R/+3R/BE/−1R) become an evenly spaced 5-column grid on mobile
  so they are tappable and never wrap awkwardly.

## 4. Feed page chrome (`src/routes/_authenticated/feed.tsx`)

- Filter summary chip: allow wrapping and drop `ml-auto` on the quota block below `sm`
  so "14 shown" and "Daily quota 6/50" sit on their own line instead of colliding.
- Empty-state padding reduced on mobile (`px-4 py-10`) so the message fits without scroll.

## 5. Tablet + other pages

- `performance.tsx`: KPI strip goes 2 columns on phones (currently 1), 3 at `sm`, 6 at
  `lg`; `TabsList` on the range switcher becomes full-width grid on mobile like the
  section tabs already are; keep table wrappers scrollable with a visible edge fade.
- `history.tsx` and `settings.tsx`: same metric-grid padding/label treatment as the
  signal card, and confirm every table stays inside `overflow-x-auto`.

## Verification

Render `/feed`, `/history`, `/performance`, `/settings` at 393px, 768px and 1280px via a
headless browser pass and check no element exceeds the viewport width and no text is
clipped.

## Technical notes

- Presentation-only edits: Tailwind classes and small JSX restructuring in the files
  listed above. No changes to queries, server functions, migrations, or grading logic.
- Follows the responsive rules already used in the codebase:
  `grid-cols-[minmax(0,1fr)_auto]` on mobile promoted to `flex` at `sm`, `min-w-0` on
  every text container, `shrink-0` only on genuinely fixed-size icons.
