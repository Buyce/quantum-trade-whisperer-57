# Smarter AI access: in-app assistant + ChatGPT / Claude / Gemini

Goal: the in-app chat and outside AI apps can do the same things, through one shared set of abilities, with clearer rules and less bulk. The AI still cannot open or change broker orders. It can only cancel a waiting order, and only after the user approves it.

## What users get

1. **One set of abilities everywhere.** The in-app chat and the P-Trades connection for ChatGPT, Claude and Gemini share the same tools, names and rules. Today the two lists have drifted apart.
2. **More to read:**
   - Account health, including the Control Center view: connection, mode, permissions, exposure and emergency stop.
   - Reconciliation "Needs review" items.
   - The account risk policy and past Runtime Validation reports.
   - Instrument/direction auto-trade policies.
   - The news blackout calendar.
3. **Checks the AI can run on request:**
   - "Run a Runtime Validation on my demo account", which is dry run only.
   - "Explain this setup", which uses the existing explainer and rule checks.
4. **Settings changes with approval.** The AI proposes a change, the user sees a before/after card with Approve/Decline, and nothing saves until they tap Approve. This covers:
   - Feed settings and brakes, as today.
   - Instrument/direction policies (allow, reduce or block).
   - Risk policy fields.

   Risk-increasing changes still need the extra confirmation. Live accounts still need a second confirmation.
5. **Cancel a waiting order (new, approval required).** The AI can list your unfilled resting orders and propose a cancel. The cancel runs only after you tap Approve. It uses the existing platform cancel path, never a new one. The AI cannot place or change orders, and cannot close open positions.
6. **Leaner, smarter answers:**
   - Shorter rules.
   - A "what can you do?" answer.
   - Suggested follow-up questions.
   - Tool results trimmed so answers are faster and cheaper.
7. **A clearer Connect page:**
   - One-click setup cards for ChatGPT, Claude, Claude Code, Gemini and any other MCP app.
   - An always-current tool list with Read / Change (approval) / Cancel (approval) labels.
   - A short "what the AI can never do" box.
8. **Guides updated:** the Guide, the assistant help, docs/LIVE-TRADING.md and the Connect page.

## Safety rules kept
- Every write works only on the signed-in user's own data. No other user's money or balances are shown.
- Validation cannot trade. This is already proven by tests and extended to the new tools.
- Cancel works only on the user's own unfilled orders that P-Trades placed. Orders in an unknown broker state are refused.
- No made-up numbers. Empty results say "nothing matched", never "No Trade".

## Technical details
- New `src/lib/ai-tools/registry.ts`: one definition per tool (schema, description, access class `read|check|propose|cancel`, and the shared body). `src/lib/mcp/index.ts` and `src/lib/assistant/tools.ts` both build from it. MCP bumps to v0.9.0.
- New tools:
  - Reads: `get_account_overview`, `list_review_items`, `get_risk_policy`, `get_cohort_policies`, `list_news_blackouts`, `list_resting_orders`.
  - Checks: `run_runtime_validation`, which wraps `runRuntimeValidation` and keeps the import-isolation test, and `explain_setup`.
  - Proposals: `propose_settings_change`, `propose_cohort_policy`, `propose_risk_policy`, and `propose_cancel_order`.
- Proposals are stored in a new `ai_action_proposals` table (owner RLS, grants, 15-minute expiry, single use). The user approves in the UI through `approveProposal` / `declineProposal` server functions. Those re-validate and then call the existing save and cancel functions (`saveAccountRiskPolicy`, cohort policy save, settings update, `cancel-delivery.server.ts`).
- In outside AI apps, a proposal returns an approval link to P-Trades. No write runs from the external AI directly.
- In-app chat: a new ProposalCard renders inside messages. Suggested prompts go on an empty thread. The system prompt is compressed and rules 1–17 are merged into short grouped rules. Chat moves to the default Lovable AI model `openai/gpt-6-astra` when no Gemini key is set. Gemini with Google Search stays when the key is present.
- Tests:
  - The registry has parity between MCP and the in-app chat.
  - Proposal tools never write before approval.
  - Cancel refuses foreign, filled or unknown-state orders.
  - Validation still makes no `/trade` calls.
  - The docs contract is updated.
