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

Implementation: `src/lib/telemetry/guardian.server.ts`,
`src/lib/telemetry/guardian-pass.server.ts`, `src/lib/accounts/read.server.ts`.
