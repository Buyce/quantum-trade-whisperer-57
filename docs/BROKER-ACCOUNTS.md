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

## Implementation

`src/lib/accounts/*`, `src/lib/metaapi/*`,
`src/routes/_authenticated/accounts.tsx`.
