# Full agent access: sign-up + expanded agent capabilities

## Where things stand today

- Agents connect over the MCP server at `/mcp`, secured with OAuth. An agent can only act as a person who **already has an account** and who approves the consent screen. There is no way for an AI to register.
- Agents get 6 tools: read live signals, scanner status, log a trade decision, set an outcome, list their trades, performance summary.
- Not available to agents: reading or changing settings (filters, daily cap, alerts, risk profile), market/session status, risk sizing per signal, learning/intelligence data, weekly A/A+ vs B/C comparison, submitting verified entry/exit prices.

So the honest answer to "is it fully allowed?" is no — this plan closes both gaps.

## 1. Agent-initiated account creation

A public registration endpoint that an agent (or any client) can call, kept safe by design:

- New endpoint `POST /api/public/agent/register` taking `email` and `password`.
- It creates the account through normal email sign-up — **email confirmation stays required**, so the human owning that inbox must confirm before the account works. An agent can start the sign-up but cannot silently own a verified account.
- Rate limited per IP and per email (small hourly ceiling) with a new `agent_registrations` table for the counter and audit trail.
- Response tells the agent exactly what happens next: "check the inbox and confirm, then connect the MCP server and approve consent."
- The `/connect` page gains a "Create an account from your assistant" section documenting the endpoint, plus the note that a confirmed account is required before OAuth.
- No auto-confirm, no service-role account creation, no agent-created passwords bypassing verification.

Because MCP is OAuth-protected server-wide, registration cannot be an MCP tool — a brand-new agent has no token yet. The REST endpoint is the correct door, and the `/connect` docs point agents at it.

## 2. New agent tools (settings, risk, market, intelligence)

Added to the MCP server, all acting as the signed-in user under existing row security:

| Tool                      | Does                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_my_settings`         | Read instruments, timeframes, sessions, min grade, alert grade, daily cap, notification prefs, risk profile (equity, risk %, leverage, max SL %, max position size).                  |
| `update_my_settings`      | Change any of the above. Values validated and clamped (risk % 0.1–10, leverage 1–500, grades restricted to A+/A/B/C, cap 0 = unlimited). Webhook URL/secret stays out of agent reach. |
| `get_market_status`       | Which sessions are open/closed right now, next open/close, and per-instrument feed health.                                                                                            |
| `calculate_position_size` | For a signal id (or explicit entry/SL), returns lot size, cash risk, margin, and any guardrail warnings — using the user's saved risk profile.                                        |
| `get_intelligence`        | Regime stats for a signal or bucket: fill/win priors with shrinkage, sample counts, whether the learning gates have cleared, and the top influencing regimes/features.                |
| `get_shadow_comparison`   | The weekly A/A+ vs B/C shadow-engine comparison: win rates, mean R, sample sizes, statistical significance.                                                                           |

Reuses the existing engines (`src/lib/risk.ts`, `src/lib/market-hours.ts`, `src/lib/learning/*`, weekly-report stats) — no duplicated maths.

## 3. Verified prices from agents

`update_trade_outcome` gains optional `actual_entry_price` and `actual_exit_price`. When supplied, R is recomputed server-side by the same auditable path the web app uses, so agent-logged trades can reach **Verified** status instead of sitting unverified. Outcome-only calls keep working. Journal deletion stays out of agent reach.

## Guardrails kept

- Every tool derives identity from the verified OAuth token; nothing takes a user id as input.
- Row security still scopes all reads/writes to that user; no service-role access inside MCP tools.
- Zero-hallucination rule unchanged: empty signal results stay empty, and tool descriptions instruct agents never to invent setups.
- Admin intelligence, webhook config and account deletion remain off-limits to agents.

## Technical notes

- Registration endpoint under `src/routes/api/public/` (public prefix), Zod-validated, generic error text so it can't be used to test which emails exist.
- Migration: `agent_registrations` (email hash, ip hash, created_at) with grants and row security; service-role-only access.
- New tool files under `src/lib/mcp/tools/`, registered in `src/lib/mcp/index.ts` with updated server instructions; MCP manifest re-extracted afterwards.
- Settings writes go through a shared validator so web UI and agents can't diverge.
- `/connect` page updated with the new tool list and the registration flow.
