# Recover the grade of every closed trade — the trail does exist

## What I found in your data (checked just now)

The grade is recoverable for **all 20** trades that currently show "—". Nothing has to be guessed.

Two surviving trails:

1. **The broker order id carries the signal reference.** Every P-Trades order id has the
   shape `PT_<signal-tail>_<delivery-id>` — the middle part is the last 18 characters of the
   original signal's id. Verified against the two trades that still have their signal link:
   `PT_19bd3a9000ddd2e5ee_6356` matches signal `c7d8b8ea-7829-4d19-bd3a-9000ddd2e5ee`.
2. **`execution_enqueue_decisions` was never purged.** It holds 858 rows keyed by signal id,
   each with instrument, grade and timestamp. Matching the 20 orphan trades through their
   order-id tail gives **exactly one signal each — 20 of 20, no ambiguity, no collisions**, and
   the instrument in the decision row agrees with the broker symbol in every case.

Recovered grades: **18 × C** (XAUUSD, EURUSD) and **2 × B** (GBPAUD). That is the honest answer
to "what is the machine learning from": the August demo losses were overwhelmingly C-grade
XAUUSD shorts, and the two B-grade GBPAUD trades both won.

What is genuinely gone and will stay blank: the exact `detected_at`, published entry/stop/target
geometry, and therefore plan-R and slippage for those rows. Those lived only in the deleted
signal and delivery rows. The earliest decision row per signal gives a "first seen at" bound,
which is stored as its own field and never presented as the detection time.

## The fix

1. **Migration on `broker_trade_evidence`**
   - Add `signal_grade_source` (`delivery` | `recovered_from_enqueue_decision`) and
     `signal_first_decision_at`.
   - Extend the immutability trigger so the characterisation fields (`signal_id`,
     `signal_instrument`, `signal_grade`, and the two new ones) may be filled **once**, only
     from NULL to a value, on closed rows — exactly like the slippage one-time backfill.

2. **A reusable recovery step, not a one-off script.** New helper in
   `src/lib/evidence/` that, given a P-Trades order id, resolves the signal reference from the
   order-id tail and looks it up in `execution_enqueue_decisions` (then `model_observations` /
   `research_candidates` as further fallbacks). It only accepts a **unique** match with an
   agreeing instrument; anything ambiguous is left unset. Wired into both
   `recover.server.ts` (orphan recovery) and `reconcile.server.ts`, so this never happens
   silently again.

3. **Backfill the 20 existing rows** through that same helper, with
   `signal_grade_source = recovered_from_enqueue_decision`.

4. **Surface it truthfully in the UI.** Trade History and the table view show the grade with a
   "grade recovered from decision log" marker; detected time stays "unavailable" for these rows
   rather than borrowing the decision timestamp. The grade filter then works on all 21 closed
   trades instead of 1.

5. **Performance and learning use them.** Grade-mix, win-rate-by-grade and per-grade net money
   include recovered grades, with the recovered-provenance population reported separately so a
   recovered grade is never mistaken for a full plan record.

## Technical notes

- Match rule: `right(replace(signal_id::text,'-',''), length(tail)) = tail`, requiring exactly
  one distinct signal id and one distinct grade; enforced in code and covered by tests.
- Files: migration; `src/lib/evidence/grade-recovery.ts` (+ tests), `recover.server.ts`,
  `reconcile.server.ts`, `src/lib/queries.ts`, `src/lib/history/broker-orders.ts`,
  `src/components/history/AutomaticOrders.tsx`, `src/lib/performance-evidence*.ts`,
  `src/lib/performance.ts`, `src/lib/export.ts`, docs `BROKER-EVIDENCE.md`.
- No estimated or synthesised value anywhere: only fields with a surviving record are filled,
  everything else stays unavailable with its reason.
