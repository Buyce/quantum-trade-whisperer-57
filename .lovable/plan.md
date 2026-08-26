# Safely restore Demo Auto execution, with a user-configurable automatic-order window

## Verified current state

- Demo Auto is enabled, forced dry-run is off, lifecycle enforcement is on, real-money execution is disabled.
- The armed demo account is CONNECTED, READY, trade-allowed, non-investor and armed as `demo_auto`.
- Dispatch runs every minute; active-signal and broker-evidence reconciliation run every five minutes.
- The account has 27 direct automatic-order attempts, **0 broker submissions and 0 broker order IDs**.
- Recent refusals were pre-broker P-Trades checks: mostly stale stored equity, plus one unavailable quote, plus older 30-minute-window expiries. No broker rejected these rows.
- The repaired preflight (fresh destination-account equity, destination-account mapped quote) is in source with focused tests and build green, but not yet reflected in production attempts.
- The window is currently a fixed 30-minute constant (`ORDER_TIF_MINUTES`) shared by the automatic-order path **and** by replay/shadow research math and grading fixtures. It cannot simply be raised globally without changing research results.
- The signals in the screenshots are 7–8 hours old, so even a 6-hour window would not make them eligible.

## Approved change: configurable automatic-order window

### 1. New user setting

- Add `auto_order_window_minutes` to the user's scanner settings, default **180 (3 hours)**, allowed range **0–360 minutes (0–6 hours)**.
- `0` means automatic orders are effectively off by window (nothing is submitted on age grounds); this is stated explicitly in the UI.
- Expose it in Settings under **Rules, alerts & automatic orders**, near the concurrent-order ceiling, with plain copy: how long after detection P-Trades may still place the automatic order, and that a longer window means acting on an older structure.
- Value is clamped and validated server-side and in the MCP settings validator, so the web UI and agent path cannot diverge.
- Include it in the settings read projection so it survives the save/refetch round trip.

### 2. Where the new window applies — and where it must not

Applies to:
- Automatic-order enqueue eligibility (direct enqueue and active-signal reconciliation).
- Dispatcher pre-send window check.
- The expiry attached to the submitted pending order, so the broker order cannot outlive the user's own window.
- User-facing refusal copy and the automatic-order decision log.

Does **not** change:
- Replay, shadow, research and grading mathematics, which keep the existing fixed 30-minute structural constant. Research history stays comparable.
- Signal grading, feed filters, alerts, daily cap, lifecycle stages, sizing, risk or spread rules.

Where the current code reads one shared constant for both purposes, the automatic-order path is switched to the per-user window while research paths keep the fixed constant.

### 3. Publish the repaired direct preflight

- Deploy the fresh-equity and destination-account quote repair together with the new window.
- Keep real-money execution disabled; do not replay or resubmit any historical refused delivery.

### 4. Verify one fresh demo canary end to end

For the next newly detected signal inside the user's window that passes instrument, session, grade, intelligence, lifecycle, account, capacity, risk, spread and broker-geometry gates:

1. One idempotent direct delivery is created for the armed demo account.
2. Preflight writes a fresh broker account observation and uses the account's mapped broker symbol and quote.
3. Sizing uses that fresh equity; the final pre-submit refresh can still cancel or resize.
4. A successful submission records the submission time, submitted volume/prices, broker result and broker order ID, with the order expiry set from the user's window.
5. Broker-evidence reconciliation then classifies it open/closed; only closed, positively matched evidence contributes to broker wins and losses.

If the broker account or quote request fails, keep the order blocked and show the exact operational cause. No cached equity, no benchmark price fallback.

### 5. Make eligibility honest in the UI

- Show the window on signal cards from the user's setting instead of a hardcoded 30 minutes.
- On signals past the window, show a distinct **automatic-order window expired** state while keeping the factual manual/feed state.
- On fresh signals excluded by the intelligence gate, show the recorded gate reason including threshold and sample sufficiency.
- Keep "active signal", "manual entry state" and "automatic-order eligible now" as three separate ideas in copy and Guide docs.

### 6. Tests and verification

- Window boundary tests: inside window enqueues, past window refuses with a recorded decision, `0` disables, values are clamped to 0–360.
- Round-trip test proving the new setting is written and read back.
- Test proving submitted order expiry follows the user's window.
- Test proving replay/shadow/grading math still uses the fixed 30-minute structural constant.
- Existing preflight regressions plus full suite, typecheck and build.

## Boundaries

- Demo auto only; real-money execution stays disabled.
- No relaxation of equity freshness, quote freshness, intelligence gate, spread, pending-limit geometry, sizing, margin, lifecycle, capacity or risk checks.
- No resubmission of the old 7–8 hour signals, no fabricated observations, quotes, submissions, evidence or outcomes.
