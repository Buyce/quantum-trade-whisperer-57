# Direct MT5 Bridge

## Goal

Add a second broker path to P-Trades without making MetaApi a single execution dependency.

```text
P-Trades strategy/risk/execution kernel
        |
        +--> MetaApi adapter
        |
        +--> Direct MT5 adapter
                  |
                  v
          P-Trades MT5 Bridge
                  |
          official MetaTrader5
             Python IPC
                  |
          MT5 desktop terminal
                  |
                broker
```

The bridge is an execution transport, not a strategy engine. It must never invent
signals, resize risk, bypass news/exposure/drawdown gates, or decide that a live
account may be armed.

## Why a local/VPS bridge

MetaQuotes' official Python package talks to a running MetaTrader 5 desktop
terminal over IPC. P-Trades' cloud/edge runtime cannot use that Windows-local IPC
directly, so a small agent must run beside the terminal, normally on a Windows
VPS for continuous operation.

The bridge initiates outbound HTTPS to P-Trades. P-Trades does not require an
inbound port on the trader's machine/VPS.

## Phase 1 — implemented foundation

`bridge/mt5/agent.py` is deliberately read-only. It:

- connects to the local MT5 terminal with `mt5.initialize()`;
- reads terminal/account health;
- reads broker positions and active orders;
- normalizes the observations into the provider-neutral broker contract;
- masks the broker login and sends only a pseudonymous account correlation key;
- emits monotonically increasing sequence numbers;
- can POST snapshots outbound when an ingest URL/token are configured;
- otherwise runs in diagnostic stdout mode.

There is intentionally no `order_send` call in Phase 1.

The TypeScript side adds:

- `src/lib/broker-gateway/types.ts` — provider-neutral broker read/execution capability boundary;
- `src/lib/mt5-bridge/protocol.ts` — versioned direct-MT5 snapshot contract;
- invariant tests that reject wrong-provider and malformed sequence snapshots.

## Security model

1. MT5 credentials remain in the MT5 terminal. The bridge does not collect or
   upload the password.
2. Cloud transport is outbound HTTPS only.
3. A bridge token must be account-scoped, revocable and stored hashed server-side
   before cloud ingestion is enabled.
4. Sequence + timestamp checks must reject replay/stale snapshots.
5. Provider identity is explicit: `mt5_direct` evidence is never silently
   relabelled MetaApi evidence.
6. Bridge connection never arms an account.
7. Live-auto owner confirmation remains mandatory.
8. No provider failover may submit after an ambiguous result. P-Trades must
   reconcile broker orders/positions first.

## Required Phase 2 before cloud use

Implement the authenticated P-Trades bridge registration/ingest path:

- generate one-time pairing token;
- store only its hash;
- bind bridge id to one owned connected account;
- ingest versioned snapshots;
- enforce sequence monotonicity and freshness;
- record last-seen/health;
- expose direct-MT5 account facts to Runtime Validation.

Until that server-side pairing exists, `P_TRADES_BRIDGE_INGEST_URL` should be
left unset and the agent is diagnostic/read-only.

## Required Phase 3 before demo execution

Add direct-MT5 implementations for:

- fresh quote and symbol specification;
- margin calculation;
- `order_check` preflight;
- idempotent client intent key;
- submit/acknowledge/fill state machine;
- positions/orders/deals reconciliation;
- SL/TP modification;
- pending-order cancellation;
- close/partial-close;
- break-even and trailing-stop modification.

Every action must flow through the existing strategy -> risk -> execution veto
kernel and the nine Runtime Validation gates.

## Demo canary

The first executable release is demo-only:

1. direct bridge healthy and fresh;
2. broker-confirmed demo account;
3. Runtime Validation all PASS;
4. one controlled order with predefined SL/TP;
5. broker acknowledgement verified;
6. fill/position reconciled;
7. SL/TP verified at broker;
8. break-even modification verified;
9. trailing-stop tightening verified;
10. close/deal history reconciled.

Any unknown state stops the canary.

## Live boundary

Direct MT5 does not create a shortcut to live auto. Promotion remains:

`observe -> demo_auto -> live_confirm -> owner-confirmed live_auto`

A direct bridge and MetaApi may coexist, but only one provider may own an
execution intent. If the active provider returns an ambiguous outcome, another
provider cannot retry the trade until broker reconciliation proves no order or
position exists.
