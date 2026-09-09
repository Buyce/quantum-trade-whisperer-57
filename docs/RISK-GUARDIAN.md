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

## Releasing a stored hold

An automatic-order hold is stored per connected account. It is released as soon as
its owner configures no limit at all — protection switched off, or every limit left
at zero:

- The evaluator writes a cleared record (not paused, no reason, no release time,
  cancellation counters back to zero) instead of skipping the account. Peak-equity
  history is an observation and is never overwritten by that clearing write.
- The hold read used by the banner and the feed only reports a stored hold while
  the caller's protection is still configured, so the notice disappears on save
  rather than at the old release time.

Clearing a hold never places, cancels or modifies anything at the broker, and never
loosens a limit that is still configured.
