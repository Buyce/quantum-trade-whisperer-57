# Why XAGUSD, USOIL, UKOIL and NAS100 are blocked

Short answer: it is **not** that the data provider refuses to trade them. Your broker
inventory (12,494 symbols) does carry these markets — it just names them differently,
and the mapping step refuses to guess. Verified from the discovery and readiness rows:

| Instrument | Mapping outcome | What the broker actually shows |
|---|---|---|
| XAGUSD | resolved exactly (`XAGUSD`), spec valid (digits 3, contract 5000) | blocked only by a quote fetch that returned rate-limit 429 and H1/M15 candle gaps |
| NAS100 | `ambiguous` — refuses to choose | `USTEC` and `USTECH100M` |
| USOIL | `ambiguous` — refuses to choose | `WTI`, `WTIB`, `WTID`, `WTIP`, `WTIU` |
| UKOIL | `missing` — no inventory symbol matched the accepted patterns (`UKOIL`, `XBRUSD`, `BRENT`) | unknown; the broker's Brent ticker is named outside those patterns |

On top of that, all four sit at lifecycle stage `disabled`, so the readiness checker
skips them — which is why the panel shows snapshots ~205 hours old and "0 valid / 0
rejected". They are frozen, not failing continuously.

## What the fix needs to do

1. **Operator alias binding.** Add an admin-only way to bind a canonical instrument to
   one exact provider symbol (e.g. NAS100 -> USTEC, USOIL -> WTI), recorded with who
   bound it and when. The mapping layer already supports a `configured` status, so a
   bound alias becomes usable without weakening the fail-closed rule that the engine
   never picks between ambiguous tickers by itself.
2. **Find UKOIL's real name.** Run a one-off inventory listing for Brent-like symbols
   and show the shortlist in the admin panel so you can bind the right one (or confirm
   the broker genuinely has no Brent, in which case UKOIL stays disabled and is
   labelled as unavailable at this broker rather than "not verified").
3. **Re-run commissioning on demand.** Let the admin panel trigger a mapping + spec +
   candle + quote readiness re-check for a chosen instrument, so a freshly bound alias
   is validated immediately instead of waiting for a cycle it is excluded from.
4. **Stop the stale-snapshot confusion.** When an instrument is `disabled`, the panel
   should say "not being checked at this stage" instead of reporting a 205-hour-old
   snapshot as a failure.
5. **XAGUSD separately.** Its mapping and spec are already good; the blockers were a
   rate-limited quote and H1 candle interval gaps. Retry its readiness check with the
   existing backoff and, if candle gaps persist, surface that as a data-quality blocker
   distinct from a naming problem.

No lifecycle promotion happens as part of this. After a successful alias binding an
instrument moves from `disabled` to `data_validation` and still has to earn its 5
trading days / sample thresholds before it can produce user-visible signals.

## Why not simply scan every broker variant

For NAS100 the broker offers `USTEC` and `USTECH100M`; for USOIL it offers `WTI`,
`WTIB`, `WTID`, `WTIP`, `WTIU`. These are not five different markets — they are the
same underlying with different contract sizes, spreads, expiries or account tiers.

Advantages of fanning out: no operator choice needed, and whichever variant your
account can actually trade is covered.

Disadvantages, and why the plan binds one variant instead:
- Duplicate signals. The same ABC structure fires on every variant, so one setup
  becomes five alerts and can consume five daily-cap slots for one idea.
- Corrupted statistics. Grade win rate, expectancy and payoff distributions would
  count the same trade up to five times, so the correlation-aware sample rules and
  the confidence intervals stop meaning what they claim.
- Wrong-instrument execution risk. Contract size and tick value differ per variant;
  sizing computed on one and sent to another produces a silently wrong lot size.
- Provider budget. Each variant costs its own candle, quote and spread reads inside
  the same rate limit that already returned 429 on XAGUSD.

Middle ground the plan keeps available: bind **one** tradable variant per canonical
instrument (chosen by you, with contract size and spread shown next to each candidate),
and keep the rejected variants recorded as known aliases so nothing is silently lost.
Adding a genuinely distinct market later — for instance a cash index alongside a
future — is a new registry entry with its own lifecycle, not a second alias.

## Technical notes

- Alias overrides stored in a new admin-writable table, read by
  `src/lib/instruments/mapping.server.ts` as the `configured` branch; discovery in
  `src/lib/instruments/discovery.server.ts` keeps refusing ambiguity on its own.
- Re-check and shortlist exposed as owner-only server functions calling MetaApi
  through the existing 8-second-timeout REST wrapper; results written to
  `instrument_alias_discovery` / `instrument_readiness_snapshots` as today.
- Admin UI additions live in the instrument diagnostics panel; no changes to scanner,
  eligibility, or auto-execution paths.
