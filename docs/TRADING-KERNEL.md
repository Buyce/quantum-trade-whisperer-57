# P-Trades Trading Kernel v1

P-Trades is structured as a selective, fail-closed trading system rather than a signal generator that happens to submit orders.

## Canonical flow

market/broker data -> data quality + provenance -> regime/context -> H4/H1 structure -> M15 setup -> optional research evidence -> strategy verdict -> risk veto -> execution veto -> broker submission -> acknowledgement/fill -> reconciliation -> immutable evidence -> research/walk-forward/holdout evaluation

A trade is execution-eligible only when all three independent layers pass:

1. Strategy: a setup exists and satisfies the owner's configured eligibility rules.
2. Risk: account policy, exposure, drawdown brakes, news policy, duplicate/same-bet controls and sizing are acceptable.
3. Execution: permissions, mapping, quote/spec freshness, spread/slippage, margin, connectivity and reconciliation health are acceptable.

FAIL or UNKNOWN at any layer vetoes. A later layer cannot override an earlier veto.

## Operating principles

- Positive expectancy is measured after costs. Win rate is never used alone.
- No-trade is a valid outcome. Ceilings are ceilings, never quotas.
- Point-in-time evidence only. Research/backtests may not see future candles, mappings or outcomes in their feature vectors.
- Out-of-sample before actionability. The shared evidence gate in src/lib/stats/evidence.ts remains authoritative; no module invents a competing sample-size threshold.
- Risk owns capital. Strategy code cannot resize beyond the risk engine or disable brakes.
- Execution owns broker truth. Request acceptance is not a fill; ambiguous outcomes reconcile and are never blindly retried.
- Unknown means stop. Stale quotes, unreadable controls, ambiguous mappings, unknown margin/reconciliation state and missing required news state fail closed.
- Version everything. Strategy, feature schema, policy, symbol mapping and provenance are stamped.
- Research cannot trade. Q-Core and exchange microstructure remain shadow-only until existing evidence machinery reaches genuine holdout-confirmed actionability.
- Spot and futures are distinct. COMEX GC/MGC may provide gold microstructure evidence; futures prices are never copied into XAUUSD broker orders.

## Existing implementation mapped to the kernel

| Concern | Authority |
| --- | --- |
| Scanner + H4/H1/M15 setup | src/lib/scanner/* |
| Instrument lifecycle/data quality | src/lib/instruments/* |
| News veto | src/lib/news/* |
| Drawdown/risk brakes | src/lib/risk/* |
| Eligibility, duplicates, same-bet, exposure | src/lib/delivery/* |
| Broker sizing/specs | src/lib/broker/* and src/lib/sizing/* |
| Final pre-send revalidation | src/lib/delivery/revalidate.server.ts |
| Runtime dry-run validation | src/lib/validation/runtime.server.ts |
| Broker reconciliation | src/lib/delivery/reconcile-active.server.ts and src/lib/evidence/* |
| Research/Q-Core | src/lib/qcore/* and src/lib/research/* |
| Exchange microstructure | src/lib/microstructure/* |
| Evidence sufficiency/holdout | src/lib/stats/evidence.ts |
| Three-layer decision contract | src/lib/trading-kernel/* |

## Promotion path

offline research -> point-in-time backtest -> walk-forward/OOS -> shadow -> forward observation -> holdout-confirmed evidence -> explicit promotion review

No automatic production mutation is permitted. Until promotion, a feature cannot authorize a broker action.

## Scorecard

The canonical descriptive scorecard is expressed in R and includes net expectancy after costs, win rate, average win R, average loss R, profit factor, cumulative net R and maximum drawdown R. Segment broker-confirmed results by instrument, direction, grade, session and regime only when the shared evidence floor is met.

## Production activation

Source-code readiness is not deployment readiness. Live AutoTrade remains fail-closed until the deployed runtime can read the account, the nine-gate Runtime Validation passes, and the broker lifecycle is reconciled end-to-end. Live-auto owner confirmation remains a hard boundary.