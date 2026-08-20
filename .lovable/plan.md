# Validate past wins: price backfill + reminders

## Goal

Let users go back to already-logged trades and add the actual entry and exit price they got, so their reported wins become verifiable (server-derived R) instead of self-reported. Then nudge them — by email and push — about trades that are still missing prices.

## 1. Backfill in the app (Trade History)

The outcome editor already accepts actual entry/exit prices and the server already derives R from the setup's own risk distance, so the mechanic exists. What's missing is visibility and a reason to do it:

- A summary bar at the top of Trade History: "X of Y closed trades are unverified — add your fill prices to verify them", with a one-click filter to show only those rows.
- Each unverified closed row gets a clear "Unverified" chip next to the outcome, plus an "Add fill prices" action that opens the editor directly (instead of the generic "Edit outcome").
- Once both prices exist, the row shows "Verified · N.NNR from your prices".
- Prices stay optional; nothing is blocked or deleted if a user never fills them in.

## 2. Email reminder

New app email template `verify-trade-prices` (React Email, brand-consistent, sent to the trade's own owner only):

- Subject: "N of your logged trades are missing fill prices".
- Body: short explanation of why prices matter (real R, honest stats), a compact list of up to 5 oldest unverified trades (instrument, direction, date, outcome), and a CTA button to the History page.
- Sent at most once every 7 days per user, and only when they have at least one closed trade with a missing price. Idempotency key derived from user + ISO week so a retry never double-sends.

## 3. Push notification

Reuses the existing Web Push delivery path:

- Title: "Verify your trades", body: "N logged trades are missing fill prices — tap to add them.", URL `/history`.
- Sent in the same pass as the email, only to users who have push enabled, and respecting the same once-per-week throttle.

## 4. Delivery schedule

A new public cron route `/api/public/cron/verify-reminders` (secret-protected like the other crons), scheduled weekly. It:

1. Finds closed trades (`outcome != 'open'`) with a null `actual_entry_price` or `actual_exit_price`, grouped by user.
2. Skips users reminded within the last 7 days.
3. Sends email + push, records the reminder, and never lets one user's failure abort the rest.

## Technical notes

- Schema: add a small `verify_reminder_log` table (`user_id`, `sent_at`, unique per user+week) with RLS and GRANTs so the throttle is enforced in the database, not in memory. No changes to `executed_trades` — the price columns already exist.
- Recipient emails come from the auth admin API inside the cron handler (privileged, server-only); no email column is added to `profiles`.
- Query logic lives in a `*.server.ts` helper; the cron route and the email/push senders call it. Template registered in `src/lib/email-templates/registry.ts`.
- Unverified/verified classification is display logic only.

## Explicitly out of scope

- No change to `regime_stats`, grading, shadow replay, or the Bayesian shrinkage. The learning engine stays isolated from user-reported data.
- No auto-deleting or auto-correcting of existing suspect rows; the admin integrity panel already flags them.
