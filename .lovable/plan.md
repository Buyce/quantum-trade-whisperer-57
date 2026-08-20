# Daily quota becomes a user choice

The scanner stops enforcing a global ceiling. Instead, each account picks its own daily cap in Settings — including "Unlimited" — and that choice governs what that user sees and is alerted about.

## 1. Scanner: no global ceiling

- `src/lib/scanner/pipeline.server.ts`: remove the post-grading cap gate, the `countToday()` helper, and the `"capped"` job result. Every qualifying setup publishes.
- `src/lib/scanner/types.ts`: remove `DEFAULT_DAILY_SETUP_CAP` (and `CAPPED_GRADES` if nothing else uses it).
- Duplicate suppression (unique index) and the 120-minute structure cooldown are unchanged — those, not the cap, are what stop repeat publishing.

## 2. Settings: pick your own cap

- `src/routes/_authenticated/settings.tsx`: keep the "Daily setup cap" field but present it as a per-account preference with an explicit "Unlimited" option (0 = unlimited), plus preset choices (10, 15, 25, 50, Unlimited) alongside a free numeric entry.
- Helper text explains it is a personal limit on how many graded setups (A+/A/B) reach you per UTC day; C-Grade never counts against it, and the engine still defaults to No Trade rather than trying to fill the number.

## 3. Feed: cap applies per user

- `src/routes/_authenticated/feed.tsx`: when the user's cap is greater than 0, show at most that many A+/A/B setups for the current UTC day (newest first); C-Grade setups always show. When the cap is 0, show everything.
- The quota strip stays, reading "Daily quota (A+/A/B) x/y" for a set cap and "Daily quota (A+/A/B) unlimited" when the cap is 0 — the progress bar is hidden in that case.

## 4. Alerts respect the cap

- `src/lib/scanner/alerts.server.ts`: per recipient, count today's graded (A+/A/B) signals already alerted; if the user's `daily_setup_cap` is greater than 0 and that count has reached it, skip email/webhook fan-out for that user only. Cap 0 means never skip. The `alert_min_grade` threshold check stays as it is.
- `src/routes/_authenticated/feed.tsx` push handler: apply the same per-user cap check before firing a browser/Android notification.

## Technical notes

- `scanner_settings.daily_setup_cap` already exists (integer, default 50). Migration only relaxes the lower bound so 0 is accepted as "unlimited" and changes the default to 0 — no new columns.
- `src/lib/db-types.ts`, `src/lib/queries.ts`, and the MCP scanner-status tool already carry the field; no change needed there.
- Grading, MetaApi fetching, queue mechanics, and the Bayesian learning engine are untouched.
- Zero-Hallucination rule respected: no seeds or placeholder rows; empty states unchanged.
