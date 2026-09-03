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

## Technical notes

- Alias overrides stored in a new admin-writable table, read by
  `src/lib/instruments/mapping.server.ts` as the `configured` branch; discovery in
  `src/lib/instruments/discovery.server.ts` keeps refusing ambiguity on its own.
- Re-check and shortlist exposed as owner-only server functions calling MetaApi
  through the existing 8-second-timeout REST wrapper; results written to
  `instrument_alias_discovery` / `instrument_readiness_snapshots` as today.
- Admin UI additions live in the instrument diagnostics panel; no changes to scanner,
  eligibility, or auto-execution paths.
