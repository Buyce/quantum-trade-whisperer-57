# Top bar: every page always reachable, scroll sideways when crowded

## What's wrong now
On phones and tablets, the bottom row of the top bar shows only 5 pages: Feed, History, Performance, Assistant and Settings. Accounts, Connect AI and Guide are left out, so they can't be found. On mid-size screens the row can also run out of room.

## Changes
1. **One page list everywhere.** Phones, tablets and PCs all show the same 8 pages: Feed, History, Performance, Accounts, Assistant, Connect AI, Settings and Guide (plus Admin for you).
2. **Sideways scrolling.** When the pages don't fit, the row scrolls left and right with a swipe, trackpad or mouse wheel. Nothing is cut off or hidden. A soft fade at the edge shows there's more.
3. **The open page stays in view.** If you're on Accounts, the row scrolls to show its tab when the page loads.
4. **Icons always visible.** Every tab keeps its icon and a short name, so names never shrink to unreadable stubs. Full names show on wide screens.
5. **Logo, Guide mode and Sign out stay fixed** at the top on every screen size and never scroll away.

## Technical
- AppShell.tsx: replace the MOBILE_NAV/DESKTOP_NAV split with one NAV list.
- Phones and tablets (below lg): full-width nav row with `flex overflow-x-auto snap-x`, `shrink-0` items, hidden scrollbar, and a mask-image edge fade.
- lg and up: inline nav inside the header with `min-w-0 flex-1 overflow-x-auto`, so a crowded PC header scrolls instead of clipping.
- On route change, call scrollIntoView({inline:"nearest"}) on the active tab.
- The header controls group stays `shrink-0`. Remove the now-redundant mobile-only Guide button.
- Check with Playwright at 360, 577, 768, 1024 and 1440px widths that all tabs can be reached.
