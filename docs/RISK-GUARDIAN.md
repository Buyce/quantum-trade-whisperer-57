# Risk Guardian

Risk Guardian represents drawdown trackers supported by the connected broker
telemetry provider. Availability is an observed feature flag, not assumed.

When supported, tracker breaches are stored with the vendor event time, relative
drawdown when supplied, absolute drawdown when supplied and the original payload.
Missing figures remain `null`; no breach count or drawdown value is fabricated.
Repeated vendor events are deduplicated by tracker and fingerprint.

When unsupported, the account view shows the recorded reason. Risk Guardian is a
monitoring surface, not a substitute for the execution ledger's pre-submit
exposure and sizing checks. It cannot prove that no unreported broker loss or
position exists.

## Provenance

Tracker availability, breach events, drawdown figures and event times all come from
the broker telemetry provider and are stored as broker-derived with the vendor's
event time. Deduplication is engine-derived; no drawdown value is ever inferred.

## Explicit non-guarantees

- Silence is not safety: no recorded breach does not prove no risk was taken.
- Risk Guardian observes after the broker acts; it is not a pre-submit safeguard.
- Missing relative or absolute drawdown stays `null` rather than resolving to zero.

## Tests

`src/lib/telemetry/__tests__/*`, `src/test/__tests__/docs-contract.test.ts`.

## Implementation

`src/lib/telemetry/guardian.server.ts`,
`src/lib/telemetry/guardian-pass.server.ts`, `src/lib/accounts/read.server.ts`.
