# Bring research capture live + full engine audit

## Why capture is dark

Nothing is broken. "Capture off / Enrolment off" is a deliberate database kill switch, not a failure:

- `shadow_engine_state.candidate_capture_enabled = false`
- `shadow_engine_state.candidate_enrolment_enabled = false`

The scanner already evaluates and labels every setup on every cycle; with capture off it simply does not write the `research_candidates` row. That is why the funnel shows all zeros (`research_candidates` = 0 rows today). It was shipped dark on purpose so the research writer could not affect published signals until it was switched on explicitly.

## Audit of live state (verified against the deployed database, 16:2x UTC today)

Working and live:

- Scan engine: cycling every 15 minutes. Latest cycle 16:15 UTC completed all 8 in-service instruments. 1,826 done jobs; the 307 failed jobs are older than 24h (last failure 24 Aug 18:45).
- Grading: live. Recent Wave 0 cycles return "No structure satisfied the ABC grading rules" — a real evaluated no-setup, not an error. 80 signals published in the last 48h (XAUUSD 35, EURUSD 27, GBPAUD 18).
- Lifecycle enforcement: ON (`lifecycle_enforced = true`).
- Spread/ATR telemetry: live every 15 minutes, Wave 0 only (58 ATR snapshots, 42 spread samples, 6 spread stat rows). One provider timeout at 15:30 was recorded truthfully, then recovered.
- Shadow replay engine: unpaused, 0 consecutive failures, last run 16:07 UTC. 485 shadow rows.
- Execution: demo auto ON, live execution OFF (`live_execution_enabled = false`) — as locked.
- News: FRED-only, still dark (coverage not healthy), 100 coverage snapshots recorded.

Instrument status:

| Instruments | Stage | Meaning |
| --- | --- | --- |
| XAUUSD, EURUSD, GBPAUD | `execution_approved` | scanned, published, executable |
| GBPUSD, AUDUSD, USDCAD, USDCHF, USDJPY | `data_validation` | scanned and measured every cycle, never published |
| XAGUSD, USOIL, UKOIL, NAS100 | `disabled` | readiness fails (mapping/spec/candles/quote) — broker does not serve them under the current mapping |

Two genuine gaps found:

1. **Wave 1 is scanned but not spread-sampled.** The sampler's expected set is still Wave 0 only (`[XAUUSD, GBPAUD, EURUSD]`), so the five `data_validation` pairs accumulate ATR/candles but no spread evidence — which is exactly the evidence their promotion gate requires. They will never mature without this.
2. **Wave 2 stays disabled.** Readiness failures are broker-side (no mapping/spec/quote). No code change can promote them; nothing will be forced.

## Plan

1. Enable research capture: set `shadow_engine_state.candidate_capture_enabled = true` via the audited control path. Capture is deadline-bounded, wrapped, and cannot throw into or delay a scan job; it writes only service-role-readable research rows.
2. Verify with evidence, not assumption: after the next 15-minute cycle, query `research_candidates` and confirm rows appear with terminal gate, provenance and (where derivable) proposed geometry; confirm published signal behaviour and cycle timing are unchanged.
3. Extend spread sampling to the five `data_validation` Wave 1 pairs so their validation evidence actually accumulates, keeping the run bounded (same 15-minute cadence, same per-run request budget and timeout ledger). Wave 2 remains excluded.
4. Leave **enrolment off** for now. Enrolment creates forward-tested shadow rows and multiplies replay load; the correct order is capture first, confirm a clean capture window, then enable enrolment as a separate decision.
5. Report the audit result in-app truthfully: the Admin funnel copy should distinguish "capture off" from "capture on, nothing captured yet".

## Technical notes

- Flag flip goes through the audited control RPC path, not a raw table update, so the change is recorded with actor and reason.
- Capture is gated per instrument by `capture_research` in `src/lib/instruments/lifecycle.ts`; `data_validation` instruments are eligible, so Wave 1 rejections get captured too — which is the point of the funnel.
- No seeds, fixtures or synthetic rows. If nothing is captured, the funnel shows zero.
- Live execution stays disabled; Wave 2 stays disabled; Wave 1 stays unpublished.
