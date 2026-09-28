# Live and automatic trading — user checklist

Plain-language guide for traders. Every step is per connected account.

Provenance: account facts, permissions, prices and margin come from the broker; limits come from the trader's own risk policy.

## The steps
1. **Connect** the account on Broker Accounts and press Refresh until it reads Ready.
2. **Control center**: check the card says Connected, Trading allowed, and nothing to review.
3. **Risk policy**: set it on the account card. Without one, no automatic orders are sent.
4. **Runtime Validation**: run it and fix the first FAIL. It is a dry run and never places an order.
5. **Demo auto** first, then on a real account **Live · confirm each**, then **Live auto** once comfortable.

## Risk policy fields
- Starting balance: the size limits are measured from.
- Normal risk per trade: what each order is sized to. Hard cap: the most ever used.
- Max daily loss / Max total loss: percent of starting balance. Trailing moves the total-loss floor up with your highest balance.
- Max trades per day, Stop after daily profit: close P-Trades for the rest of the UTC day.
- Equity Edge Instant 50K preset: 0.25% normal risk, 1% cap, 3% daily, 5% trailing total, 2 trades/day, stop after 200 profit.
- Blank = no limit. Real-money accounts ask for confirmation on save.

## Runtime Validation checks (in order)
connection, fresh broker facts, account type and permission, risk policy, broker symbol name, fresh price and contract details, lot size, broker margin, open review flags. First FAIL stops the run; later checks read Not reached.

## Control center and Needs review
Shows connection, mode, permission, risk policy, open/waiting orders and emergency stop. "Needs review" lists disagreements between the broker and P-Trades; nothing is fixed automatically. Check in your platform, then Acknowledge. An open critical item fails validation.

## Per-instrument choices
Settings: each instrument and direction can be Allow, Reduce (25/50/75% of normal risk) or Block for automatic orders only.

## Explain this setup
Checks a signal against your own rules and has AI write a plain summary. Not a trade instruction; cannot place orders.

## Live modes and emergency stop
Live · confirm each waits for your approval on Trade History. Live auto sends without asking after you sign off your settings. The emergency stop halts new orders immediately but never closes open positions.

## What the assistant can and cannot do
It can explain these steps, look up your accounts and tell you which step is missing. It cannot arm accounts, save a policy or place orders.

## Tests that guard this
Runtime Validation's no-order guarantee is covered by `src/lib/validation/__tests__/runtime-validation.test.ts`; account policy limits by `src/lib/accounts/__tests__/policy.test.ts`.

## What AI assistants can do (v0.9)

The in-app assistant and outside AI apps (ChatGPT, Claude, Claude Code, Gemini, any MCP app) share one list of abilities, shown on the Connect page.

- **Read:** your setups, accounts, trades, performance, risk policies, review items, waiting orders, automatic-trading rules and upcoming high-impact news.
- **Check:** run a Runtime Validation (dry run, never trades).
- **Propose (you approve):** a risk policy, an allow/reduce/block rule, or cancelling a waiting order. A proposal changes nothing. In P-Trades an Approve card appears. Outside AI apps give you an approval link. Either way it expires after 15 minutes and works once.
- **Never:** place or modify orders, close positions, arm accounts, or see other users' data.
