# Broker accounts

## Connection boundary

Broker Accounts connects MT4 or MT5 through MetaApi. The user enters MetaTrader
credentials only on the provider's secure page; P-Trades stores the provider
account reference, never the MetaTrader password.

The user's Demo/Live choice is onboarding intent. Only the account type returned
by the broker is authoritative. A mismatch stops the lifecycle. Unknown, contest,
read-only, not-ready, trade-disabled or investor-mode accounts cannot be armed.

## Modes and gates

| Mode                 | Account requirement                                     | Order permission                                                          |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| Observe              | Any connected account                                   | None                                                                      |
| Demo auto            | Broker-confirmed demo, ready, writable, explicit arming | Also requires the system-wide demo-auto gate                              |
| Live on confirmation | Broker-confirmed real account                           | Also requires the independent global live gate and per-order confirmation |
| Live auto            | Broker-confirmed real account                           | Also requires global live and live-auto gates                             |

Every direct delivery is sized from fresh broker equity and the account's symbol
specification. Broker minimum/maximum/step volume, stop distance, quote freshness,
account readiness and the owner-configured exposure boundary all fail closed.

## Research consent

Pooled research consent defaults to `false`. Enabling records the current consent
version and decision timestamp. Future positively associated customer evidence
may then carry a random `ra_` pseudonymous research reference. No user id, broker
login, email, MetaApi account reference, order id or client id is published to a
research surface.

Withdrawal records a new decision and stops future pooling immediately. Rows
already observed under valid consent retain their historical consent snapshot;
history is not rewritten.

## Disconnect

Disconnecting removes the provider connection and stops future observation and
execution. It does not alter the broker account and does not delete existing
journal, delivery or evidence history.

Disconnect can never be blocked. If the provider refuses removal, the owner can
release the connection on the P-Trades side, which frees the account slot and
states that the provider-side account may still exist. A connection pointing at
the reserved P-Trades engine account can never be armed, refreshed or issued a
login page, and is removed locally without any provider mutation.

## Broker telemetry surfaces

Two read-only observation surfaces hang off a connected account. Both describe
what a broker reported; neither is a control that can stop an order.

| Surface       | What it reports                                                                       | State when the account does not report it       |
| ------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| MetaStats     | Broker-side trade history and account metrics, gated by provider feature availability | `unavailable` — never back-filled from Settings |
| Risk Guardian | Drawdown-tracker breach events, deduplicated per event and timestamped by the broker  | `unavailable`, with no breach implied           |

Both surfaces expose three honest states: `processing` while the provider is still
computing, `unavailable` when the account or plan does not offer the feature, and
`refused` when a fetch failed or returned data too stale to trust. None of the
three is rendered as a zero, a pass, or an absence of risk.

## Provenance

Account type, readiness, equity, symbol specifications, MetaStats metrics and Risk
Guardian events all come from the broker via MetaApi and are labelled broker-derived
and timestamped by the broker's own observation time. Position sizing that uses them
comes from the shared sizing service (engine-derived). Settings equity is
user-reported and is never substituted for broker equity.

## Failure behaviour

Every gate fails closed: a missing specification, a stale quote, an unready account,
an unconfirmed account type or an exceeded exposure boundary refuses the delivery and
names the reason. A refusal is never downgraded into a default value.

## Explicit non-guarantees

- Risk Guardian is monitoring, not a pre-submit safeguard: it observes after the
  broker acts, so no reported breach does not prove no risk was taken.
- MetaStats figures are the broker's, computed on the provider's schedule; they are
  not a live account read and may lag.
- Connection does not imply permission: no mode is armed by connecting, and no
  account qualifies for every mode.
- An exposure boundary is advisory and derived from logged deliveries, not from
  broker margin state.

## Implementation

`src/lib/accounts/*`, `src/lib/metaapi/*`, `src/lib/telemetry/*`,
`src/routes/_authenticated/accounts.tsx`.

## Tests

`src/lib/accounts/__tests__/*`, `src/lib/telemetry/__tests__/*`,
`src/test/__tests__/docs-contract.test.ts`.
