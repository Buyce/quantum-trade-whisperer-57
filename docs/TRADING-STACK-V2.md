# P-Trades Trading Stack V2

This document is the integration map for the quant-style decision, risk and
execution architecture. It distinguishes code that is production-authoritative
from code that is deliberately shadow-only or unavailable.

## Canonical flow

```text
broker / market evidence
        |
data quality + provenance
        |
regime + H4/H1 context
        |
M15 setup / liquidity evidence
        |
STRATEGY VETO
        |
account policy + projected prop loss + same-bet/exposure
        |
RISK VETO
        |
news + quote/spec + spread/slippage + margin + reconciliation
        |
EXECUTION VETO
        |
provider adapter (MetaApi today; direct MT5 execution not yet enabled)
        |
broker acknowledgement -> fill -> position
        |
partial exits -> break-even -> reduce-only trailing
        |
reconciliation -> evidence -> flight record
        |
shadow replay / walk-forward / holdout
```

Any FAIL or UNKNOWN in an execution-required gate means no new order.

## Integrated now

### Strategy/risk/execution kernel

`src/lib/trading-kernel` is the canonical three-veto contract. Later layers
cannot override an earlier veto.

### Account / prop rules

`src/lib/accounts/policy*` remains the production account-policy authority.
`src/lib/trading-stack/prop-projection.ts` adds a pure projected-state guard:
the full proposed initial risk is subtracted before checking hard daily/total
loss floors. It also supports a per-account maximum-lot ceiling when one is
provided. Missing facts for enabled hard limits fail closed.

The projected module does not replace broker-wide history collection in
`policy.server.ts`; it is a final calculation building block for the sizing
boundary.

### Multi-account orchestration

`multi-account.ts` evaluates one setup independently for every account. It has
no copy-lot path. Each account needs its own strategy/risk/execution gates and
broker/risk-derived volume.

### Managed exits

Demo managed exits support ordered partial -> break-even -> trailing behaviour.
A two-step runner can now remain under management after break-even when the
owner enabled trailing. A trail must:

- be based on broker-observed best price;
- use known original risk distance;
- improve beyond break-even;
- remain behind current market;
- tighten an existing stop, never widen it.

Live managed exits remain outside the current safety boundary.

### Execution quality and correlated exposure

Existing execution-quality cooldowns and same-bet controls remain authoritative.
V2 does not create a second scoring system.

### Direct MT5

Direct MT5 observation/pairing is implemented. Direct MT5 execution remains
UNAVAILABLE. There is no `order_send` capability in the bridge release.

### Exchange microstructure

The existing microstructure layer remains SHADOW and `executionEligible:false`.
A future COMEX GC/MGC feed may populate it, but futures evidence cannot copy a
futures price into an XAUUSD order and cannot influence production until the
evidence gate is satisfied.

### Digital twin

`digital-twin.ts` subtracts explicit spread/slippage/commission R from supplied
replay outcomes. It cannot synthesize fills and is hard-coded
`executionEligible:false`. It is measurement infrastructure, not an optimizer.

### Adaptive learning

Q-Core, walk-forward and evidence machinery remain research-only. No recent
trade can self-modify production parameters. Promotion requires the single
statistical sufficiency gate and genuine forward/OOS evidence.

### Flight recorder

`flight-recorder.ts` defines the immutable decision snapshot contract:
instrument/direction/grade, account/provider, quote time, regime/session/news,
the complete three-layer decision and model versions. Persistence at every
broker-submission boundary is the next wiring step; the type exists now so new
providers cannot invent incompatible audit records.

## Capability modes

`src/lib/trading-stack/capabilities.ts` is the explicit registry.

- `enforced`: may affect execution only when `executionAuthority=true`.
- `shadow`: may observe/measure, never authorize or veto production.
- `unavailable`: not a usable capability.

Adding a provider, UI card or research calculation is therefore not enough to
make it execution-authoritative.

## Remaining staged work

1. Deploy current database/application changes and prove direct-MT5 observation.
2. Direct-MT5 quote/spec/margin/order_check adapter.
3. Nine-gate Runtime Validation on a broker-confirmed demo account.
4. Controlled demo `order_send` canary with idempotency and reconciliation.
5. Verify SL/TP, partial, break-even, trailing and close/deal history end to end.
6. Persist flight records at every broker-submission decision boundary.
7. Add prop-program schema fields only from verified firm rules; never hard-code
   unverified restrictions.
8. Connect a licensed centralized exchange data provider for GC/MGC and collect
   shadow observations.
9. Run digital-twin + chronological walk-forward + genuine forward holdout.
10. Promote a research feature only through the evidence gate.
11. Add the operational command-centre UI over these same canonical states.

No stage is allowed to skip directly to live-auto.
