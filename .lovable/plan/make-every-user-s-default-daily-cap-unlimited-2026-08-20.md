# Make every user's default daily cap unlimited

Currently `daily_setup_cap` defaults to `0` (unlimited) for new accounts, but existing accounts still carry legacy values (`30`/`50`). This plan ensures every user starts at unlimited and can change it later.

## 1. Verify current schema default

- Confirm `public.scanner_settings.daily_setup_cap` default is `0` and `NOT NULL`.
- Confirm new-account creation via `handle_new_user()` writes the default value (no explicit cap override).

## 2. Update existing accounts to unlimited

- Run a data operation: `UPDATE public.scanner_settings SET daily_setup_cap = 0;` so every current account is reset to unlimited.
- This is a data operation, not a schema change; it will use the data insert/update tool.

## 3. Verify UI/UX handling of `0`

- Settings page: ensure `daily_setup_cap = 0` is rendered as "Unlimited" and the free input / presets allow 0.
- Feed quota strip: ensure `0` displays "unlimited" with no progress bar and no cap applied to the A+/A/B feed filter.
- Alert logic: ensure `0` is treated as "never skip" for email, webhook, and push notifications.

## 4. Verify no scanner-side global cap remains

- Confirm `src/lib/scanner/pipeline.server.ts` does not enforce a daily count ceiling.
- Confirm the per-user cap only applies in feed, alert fan-out, and push handling.

## Outcome

All users begin with unlimited daily A+/A/B signals. They can lower it in Settings whenever they want.
