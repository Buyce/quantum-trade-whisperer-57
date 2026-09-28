# Update tour, guide, Guide Mode and assistant for live and auto-trading features

Goal: a trader can find out, in the app, how to move from a connected account to live or automatic trading safely, and what each new feature does.

## What users will see

1. **Guide page: new "Live and automatic trading" section** covering:
   - A step-by-step path: connect the account → check the control center → set a risk policy → run a Runtime Validation → arm Demo auto, then Live confirm-each, then Live auto
   - Risk policy: what each field means (starting balance, normal risk and hard cap, daily/total loss, trailing, trades per day, stop-after-profit), how the Equity Edge 50K preset works, and that no policy means no automatic orders
   - Runtime Validation: what the nine checks mean, how to read a PASS or FAIL, and that it never places an order
   - Control center and "Needs review" flags: what a mismatch between the broker and P-Trades means, and when to tap Acknowledge
   - Per-instrument allow, reduce or block for automatic trading
   - Explain this setup: what it checks and what it can't do
   - Live confirm-each vs Live auto, the emergency stop, and what happens to open positions
2. **Correct outdated text** in "What is each screen for?", "What do Observe, Demo auto and Live modes permit?" and "What should I do first?", which still say the live gates are off and don't mention the new steps.
3. **Guide Mode "?" explanations on the Accounts page**, each linking to the new guide section, for: the control center, the risk policy form, Runtime Validation, the arming choices and the emergency stop.
4. **First-login banner** gets one more line: "Trading live? Follow the live checklist" (links to the guide).
5. **Assistant**:
   - Gets a new "Live and automatic trading" help article, written in plain language
   - Can walk a user through the checklist, point out which step they're missing, and explain a failed validation check
   - Still can't arm an account, save a policy or place an order

## Technical details

- `src/routes/_authenticated/guide.tsx`: add section `live-trading` with entries `live-checklist`, `risk-policy`, `runtime-validation`, `control-center`, `cohort-policies`, `explain-setup`, `live-modes`; rewrite the entries `first-steps`, `tour` and `account-modes`.
- `src/routes/_authenticated/accounts.tsx`, `src/components/accounts/RiskPolicyForm.tsx`, `ControlCenter.tsx`, `RuntimeValidationPanel.tsx`: add `GuideDetail` with an `anchor` for each.
- `src/components/OnboardingBanner.tsx`: add a checklist link.
- New `docs/LIVE-TRADING.md`, registered in `src/lib/assistant/knowledge.ts`. Update `docs/BROKER-ACCOUNTS.md`: Runtime Validation is no longer owner-only, and add the risk policy form.
- `src/lib/assistant/system-prompt.ts`: add one rule. For live or auto questions, use `list_my_accounts` and the account's risk policy and validation state to find the next missing step. Never claim an account is ready without broker facts.
- Run the docs-contract and knowledge tests, plus a typecheck.
