# Fix the duplicated top bar, and make automatic-trade control findable

Two separate problems, one small fix and one navigation/labelling fix.

## 1. Duplicated top bar on Broker Accounts

Cause is confirmed: the signed-in layout already wraps every page in the app
shell (header, desktop nav, mobile nav). The Broker Accounts page wraps itself
in that same shell a second time, so its header renders twice — and only there.

Fix: remove the second wrapper from the Broker Accounts page and let it use the
shared one, like every other page. Its own page padding is dropped too, so the
page width and spacing match Signal Feed, Trade History and Settings instead of
being slightly narrower.

Nothing else on that page changes.

## 2. Nobody can find the automatic-trade rules

Today the rules that decide automatic orders are the same rules that decide your
alerts — instruments, sessions, execution grade tier and daily cap live in
"Filters & alerts", money limits live in "Risk" — and the read-only "Automatic
trading" summary that explains what those rules mean for real orders is buried
at the top of the "Notifications" tab. So the controls exist, they just are not
labelled as automation anywhere.

Changes (no second set of switches, no new rule fields):

- Rename the first Settings tab from "Filters & alerts" to
  **"Rules, alerts & automatic orders"**, and keep it first so it is the landing
  tab.
- Move the "Automatic trading" summary card out of Notifications and to the
  **top of that first tab**, so opening Settings immediately shows what is armed,
  which instruments/sessions/grade/cap govern automatic orders, and how many of
  today's cap is used.
- Inside the summary, keep the existing arming pointer but make it a real link to
  Broker Accounts, and add a line pointing at the Risk tab for position size
  limits, so the two remaining halves are one click away.
- Rewrite the section headings on that tab so each says what it governs: feed
  filters that only affect what you see, versus the alert/execution tier and
  daily cap that also govern automatic orders.
- The Notifications tab keeps push and email delivery only.

## 3. Accounts in the top navigation

Broker Accounts is reachable only through Settings today. Add it to the main
navigation:

- Desktop nav gains an **Accounts** item (plug-style icon) between Performance
  and Connect AI.
- The mobile bottom bar stays at five items — a sixth column truncates labels at
  ~360px — so on phones Accounts stays reachable from Settings → Account, whose
  existing "Manage broker accounts" button remains.

## Technical notes

- `src/routes/_authenticated/accounts.tsx`: delete the nested `AppShell` import,
  wrapper and its `mx-auto max-w-[1100px] px-3 py-5` container; the layout at
  `src/routes/_authenticated/route.tsx` already supplies both.
- `src/routes/_authenticated/settings.tsx`: rename the `filters` tab label, move
  `<AutoTradingSummary ... />` from the `notifications` tab into the top of the
  `filters` tab (same props, same live queries), adjust section headings.
- `src/components/AutoTradingSummary.tsx`: turn the arming sentence into a
  `<Link to="/accounts">` and add the Risk-tab pointer line.
- `src/components/AppShell.tsx`: add the Accounts entry to `DESKTOP_NAV` only,
  leaving `MOBILE_NAV` at five items; update the comment that documents the cap.
- No schema, server-function, eligibility or execution-gate changes: the rules
  and gates that decide an automatic order are untouched, this is labelling,
  placement and navigation only.
- Verification: existing suite plus the docs/semantic contract tests; check the
  Broker Accounts page renders a single header at desktop and mobile widths.
