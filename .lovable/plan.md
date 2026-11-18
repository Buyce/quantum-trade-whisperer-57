# Why Peter Live placed no automatic trades today

## What the records show (read-only check, 18 Nov 09:05 UTC)

- The scanner is working: 36 new setups in the last 12 hours, newest at 08:45 UTC.
- Peter Live is **connected**, but it is now set to **Observe** and the broker reports **trading not allowed** (trade_allowed = false). Last account refresh: 05:04 UTC today.
- Because of that, Peter Live has had **no automatic-order decisions at all since about 16:30 UTC yesterday**. The last live order record was 11:35 UTC yesterday (accepted by the broker).
- Yesterday's live setups that were checked were refused for normal reasons: too old (15-minute window) or expected return below your 0.1R floor.
- The demo accounts are still trading/being checked, so the problem is specific to the live account, not the whole terminal.

## Most likely cause (not yet confirmed)

When the 5-minute account refresh reads the account from MetaApi and the broker says trading is not allowed, P-Trades safely switches the account to Observe. That matches what we see. But the reason it saved was **wiped on the next refresh** (the field is now empty), so I cannot yet prove whether:
1. the broker/MT5 side turned trading off (e.g. broker disabled trading, password/permission change, the MetaApi connection now uses a read-only login), or
2. someone pressed Observe on the account card.

## Plan

1. **Confirm the cause (read-only):** read Peter Live's account information directly from MetaApi now (tradeAllowed, investor mode, login type) and check the refresh logs around the switch. No orders, no mode changes.
2. **Fix the lost reason:** when an account is switched to Observe automatically, keep the reason and time permanently (append-only history) instead of erasing it on the next refresh. Show it on the Accounts card: "Automatic orders stopped at HH:MM because your broker reports trading is not allowed."
3. **Alert:** send the owner a notification/email when a live account is stopped automatically, so it is never silent again.
4. **Tests:** reason survives later refreshes; manual Observe vs automatic stand-down are labelled differently.

## What I will not do

- I will not switch Peter Live back to Live Auto or change any risk settings. Once the broker shows trading allowed again, you turn it back on from the account card.

## Likely owner action

If step 1 confirms the broker reports trading not allowed: check in MT5 / with Equity Edge that trading is enabled on this account and that the MetaApi connection uses the master (trading) password, then press Refresh and set Live Auto on the Peter Live card.
