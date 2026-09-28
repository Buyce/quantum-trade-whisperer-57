# Let outside AI apps trade for users (approve once per session)

## What users get
An outside AI (ChatGPT, Claude, Gemini, any MCP client) can place trades, change stop loss / take profit, close all or part of a position, and arm accounts, on demo and live accounts. The user approves once, and the AI can then act on its own until the session ends.

## How the "session" works
1. The AI asks for trading access. It gets a P-Trades approval link (same as today's proposals).
2. On the approval page the user picks:
   - which accounts (each one shown as DEMO or LIVE)
   - which actions: place / change / close / arm
   - how long: 15 min, 1 h (default), 4 h, 8 h max
   - limits: max orders in the session (default 5), max risk per order (never above the account's risk policy), and whether live accounts are included (a separate tick box with a real-money warning)
3. Once approved, the AI can act directly within those limits. Every action shows in a new "AI sessions" card on the Accounts page, with a **Revoke now** button.
4. The session ends when time runs out, the order cap is reached, the user revokes it, or any emergency stop is pressed.

## What stays in force (cannot be turned off by the AI)
- Every order goes through the same path the bot uses: account risk policy, broker-derived sizing, stop/target on the correct side, stop distance limit, daily loss / trade count limits, news blackout, blocked / reduced instruments, duplicate and same-bet limits, market hours, and a fresh check just before sending.
- Live accounts need a passing Runtime Validation in the last 24 h before the AI can place a live order or arm a live account.
- Arming to live auto still needs the user's existing signed confirmation of their current settings; the AI cannot sign it.
- Emergency stops and the system-wide live switches always win.
- Orders with an unknown broker state are never resent.
- The AI only ever sees and acts on the signed-in user's own accounts.
- Every AI action is logged with the session, the AI app's name, and the broker's reply, and is labelled "placed by AI" in Trade History.

## Free-form trades
The user (through the AI) can describe any trade: instrument, direction, market or limit, entry, stop loss, take profit. A stop loss is mandatory. Size is always calculated by P-Trades from the risk amount, never taken from the AI.

## Technical details
- New table `ai_trading_grants` (user, client_id, account ids, allowed actions, include_live, max_orders, orders_used, max_risk_percent, expires_at, revoked_at). Owner-read RLS; writes only via server functions. Migration includes grants.
- Grant request reuses `ai_action_proposals` (new kind `trading_grant`) and the existing `/approvals/$id` page with an extended form.
- New shared bodies in `src/lib/ai-tools/bodies.ts`, one MCP file each in `src/lib/mcp/tools/`:
  `request_trading_access`, `get_trading_access`, `place_order`, `modify_position`, `close_position`, `modify_resting_order`, `arm_account`.
- Each action: load active grant for (user, OAuth client_id) with a row lock, check scope / live / cap, then call existing code only:
  - place: new manual-intent entry into `direct-enqueue.server.ts` (single user, single account, `source='ai_grant'`), so sizing, gates and `revalidate.server.ts` are shared; delivery via `dispatch.server.ts`.
  - modify / close: `modifyPositionProtection`, `partialClosePosition` from `metaapi/trade.server.ts`, after an ownership + position-tag check.
  - arm: `setAccountMode` from `accounts/arm.server.ts` (keeps its live confirmation rules).
- Emergency stop handlers revoke all active grants for the user.
- In-app assistant gets the same tools (registry `surfaces: mcp|in_app`), same grants.
- Runtime Validation stays import-isolated from send paths (unchanged).
- Registry, `AI_NEVER`, Connect page, `docs/MCP.md`, `docs/LIVE-TRADING.md`, Guide, system prompt rule 18 updated; MCP version 1.0.0; manifest regenerated.
- Tests: no action without a grant; expired / revoked / wrong client / wrong account / cap reached refused; live refused without include_live or recent validation; size never taken from input; missing stop refused; emergency stop revokes; each action reaches only the shared path.
- Browser check on a demo account: request access, approve, place a small demo order, move its stop, close it, revoke.
- Publish required for customers and outside AI apps.
