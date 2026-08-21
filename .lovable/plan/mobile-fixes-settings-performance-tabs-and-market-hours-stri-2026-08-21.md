# Mobile fixes: Settings/Performance tabs and Market hours strip

Three presentation-only fixes. No changes to queries, scanner logic, or data.

## 1. Overlapping tab rows (Settings + Performance)

Cause confirmed in the code: the shared tab bar is locked to a fixed 36px height
(`h-9`), while these pages put 5 and 6 tabs into a 2-column grid on mobile. The
extra rows render outside that fixed height, so "Notifications / Diagnostics /
Account" and "By instrument / By grade / Signal audit / Learning" print on top of
the panel content underneath.

Fix:

- Let the tab bar grow when it wraps to multiple rows: allow auto height on the
  multi-row lists instead of the fixed single-row height, with row gaps so each
  row has its own space.
- Settings: 2 columns on phones, 3 at `sm`, single row at `lg`.
- Performance section tabs: 2 columns on phones, 3 at `sm`, single row at `lg`.
- Give each trigger a comfortable tap height (~40px) and let long labels stay on
  one line inside their cell.
- The range switcher ("My trade log / Scanner baseline") already only has two
  tabs and stays as-is.

## 2. Market hours strip on the feed

At 393px the four sessions sit in two columns, so "Sydney"/"London"/"New York"
truncate to "Syd…"/"Lon…"/"New …" and the countdown wraps onto a second line.

Fix:

- One session per row on phones (2 columns from `sm`, 4 from `lg`), so full
  names always render.
- Countdown stays right-aligned on its own, no wrapping; shorten the phrasing on
  mobile to `1h 54m left` / `in 2h 54m` and keep the full "closes in …" wording
  from `sm` up.
- Header line ("2 of 4 sessions open · scanner session tokyo") wraps cleanly and
  the instrument feed chips get a little more vertical spacing so they don't
  crowd the divider.

## 3. Verification

Headless pass over `/settings`, `/performance` and `/feed` at 393px, 768px and
1280px: confirm no tab label overlaps content, no session label is truncated,
and nothing exceeds the viewport width.

## Technical notes

Files touched: `src/components/ui/tabs.tsx` (allow multi-row lists without
changing default single-row behaviour), `src/routes/_authenticated/settings.tsx`,
`src/routes/_authenticated/performance.tsx`, `src/components/MarketStatus.tsx`.
Tailwind classes and small JSX only.
