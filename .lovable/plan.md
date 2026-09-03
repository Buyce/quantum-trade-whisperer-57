# Fix Candidate lineage: wrong column names in the lineage read

## What is actually wrong (verified)

The panel error `column x.reason does not exist` is literal. The lineage database
function reads the automatic-order decision table using two column names that table
does not have:

| Function asks for | Table actually has |
| --- | --- |
| `x.reason` | `detail` |
| `x.decided_at` | `created_at` |

Confirmed against the live schema: `execution_enqueue_decisions` has
`id, signal_id, user_id, instrument, grade, decision, detail, enqueued, filtered, created_at`.
Every other column the function reads (replay status, resolved outcome, realized R,
research window status, broker state, broker money, `r_vs_plan`) does exist — I ran the
corrected query against real data and it returned 50 rows, so this is the only defect.

Because the whole result is built in one statement, those two names make the entire
function raise, which is why the panel shows no lineage at all rather than a partly
filled table.

## The fix

One migration that replaces `get_admin_candidate_lineage()` with the same shape, mapping
the real columns to the names the panel already expects:

- `d.detail AS enqueue_reason`
- `d.created_at AS enqueue_decided_at`, and the "latest decision" ordering uses
  `created_at` instead of the non-existent `decided_at`

Nothing else changes: same admin-only guard, same paging, same joins, same output keys.
No UI change is needed — `CandidateLineagePanel` already reads `enqueue_reason`.

## What you will see afterwards

The Candidate lineage table renders one row per enrolled candidate (228 enrolled today),
newest enrolment first, with:

- scanner stage: instrument, direction, detection time, the gate that ended it
- enrolment: enrolled at, research plan id
- replay outcome: status, realized R, target touched — or the explicit
  `outside_replay_window` label for the older backlog
- enqueue and broker columns filled only for candidates that were actually published and
  auto-ordered; rejected ones keep saying "never sent — no broker order"

The honest boundary stays in place: a rejected setup has no broker fill and no money P/L,
only a replay-derived R from real candles.

## Technical notes

- New migration: `CREATE OR REPLACE FUNCTION public.get_admin_candidate_lineage(integer, integer)`
  with the corrected column references, re-applying the existing `REVOKE`/`GRANT EXECUTE`
  lines so privileges are unchanged.
- No changes to `src/lib/candidates.functions.ts` or the panel.
- Verification after the migration: call the RPC and confirm `rows` is non-empty and
  `total_enrolled` matches the funnel's enrolled count.
