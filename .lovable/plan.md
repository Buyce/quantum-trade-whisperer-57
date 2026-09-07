# Mobile and tablet layout audit — findings and repairs

## What I checked

- Public pages (`/`, `/calculator`, `/auth`, `/connect`) rendered in a real browser at
  360x900, 390x844, 768x1024 and 820x1180.
- Every screen with a data table, plus the newly added pieces: the take-profit target
  choice in Settings, the "Automatic trader by exit target" block in Admin, the new
  Guide entry, and the exit-variants research table.

## Result of the browser pass

No spill on any public page at any of the four sizes: page width equals screen width
and no element sits outside it. Nothing to repair there.

The signed-in screens (Feed, History, Performance, Settings, Guide, Accounts, Admin)
could not be rendered in the check because the automated browser has no signed-in
session. They were reviewed by reading the layout rules instead, which is reliable for
the problems listed below (they are all width rules, not runtime behaviour). After the
repairs, I'll ask you to open Settings and Admin on your phone once so we confirm on a
real device.

## What the review found

The new pieces are fluid by construction: the take-profit chooser is a full-width
selector with wrapping text, and the by-target totals in Admin stack to one column on a
phone, two on a small tablet, three on a wide screen. No fixed widths, no side-scroll.

The real problems are older tables, and they fall into two groups.

### Group A — tables that squeeze instead of scrolling (columns crush and misalign)

These sit in a horizontally scrollable box but have no minimum width, so on a phone the
browser compresses them instead of letting them scroll: headings wrap onto three lines,
numbers stop lining up under their headings, and long labels break mid-word.

- Exit variants (6 columns, and the longest row labels in the app, e.g. "Half out at
  first target, rest to second (stop to break-even)")
- Execution quality (per account/instrument/session)
- Auto-trader outcomes
- Gate evidence
- Walk-forward confirmations
- Research candidates (four tables)
- Candidate lineage
- Performance grade table

Fix: give each a sensible minimum width so it scrolls sideways as one aligned table
instead of crushing, matching what the automatic-orders and audit tables already do.

### Group B — tables with no scroll box at all (these can push the page sideways)

- Admin: shadow-by-session, decision comparison, grade calibration, evidence tiers,
  recent replays (5 to 9 columns each)
- Admin → Intelligence: "Volume by instrument"

Fix: wrap each in the same scrollable box and give it a minimum width. The recent-replays
table already scrolls vertically with a sticky header; it keeps that and gains horizontal
scroll.

### Group C — small crowding items

- Settings, adaptive-ceiling inputs: two number fields side by side at all sizes; the
  labels wrap awkwardly under ~380px. Stack them on the narrowest phones.
- Admin panel headers put a title and a status note on one line; on a phone the note can
  crowd the title. Allow it to drop below the title on narrow screens.
- Long numeric cells in Admin (money and R values) should not wrap mid-number.

## Repairs, in order

1. Add the missing scroll boxes (Group B) so no admin table can push a page sideways.
2. Add minimum widths across Group A and B so tables scroll as aligned tables.
3. Apply the Group C crowding tweaks.
4. Re-run the browser overflow check on the public pages, and add the signed-in routes to
   that check so any future spill is caught automatically rather than by eye.
5. You confirm Settings and Admin on your phone.

Nothing in this touches trading logic, settings values, data or the numbers shown — only
how wide things are allowed to be and when they wrap.

## Technical notes

- Files: `src/components/admin/AdminPanels.tsx` (5 unwrapped tables, panel header row),
  `ExitVariantsPanel.tsx`, `ExecutionQualityPanel.tsx`, `AutoTraderPanel.tsx`,
  `GateEvidencePanel.tsx`, `WalkForwardPanel.tsx`, `CandidatePanel.tsx`,
  `CandidateLineagePanel.tsx`, `src/routes/_authenticated/admin/intelligence.tsx`,
  `src/routes/_authenticated/performance.tsx`, `src/routes/_authenticated/settings.tsx`.
- Pattern to apply: `<div className="overflow-x-auto"><table className="w-full min-w-[Npx]">`,
  with N chosen per column count (~420px for 3 columns up to ~760px for 9).
- Verification: extend the Playwright overflow assertion (document `scrollWidth` equals
  `clientWidth`, and no non-fixed element outside the viewport) to the authenticated
  routes using the injected preview session, at 360/390/768/820 widths.
