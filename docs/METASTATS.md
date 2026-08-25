# MetaStats telemetry

MetaStats is optional per-account broker telemetry. The collector records the
vendor response as one of:

- `ok` — numeric metrics explicitly returned by the vendor;
- `processing` — the vendor is still preparing history, so no metrics are shown;
- `unavailable` — the request was refused or the feature is unavailable, with a
  reason when supplied.

Missing metrics never become zero. Only finite numeric vendor fields are exposed.
Snapshots carry their observation time and are read only by the owner or an
administrator.

Vendor usage is budgeted durably before each attempt, so a failure cannot cause an
unbounded retry loop. MetaStats is monitoring; it does not arm execution, alter
signals or populate the journal.

## Provenance

Every metric comes from the MetaApi MetaStats vendor endpoint for that connected
account and is labelled broker-derived, carrying the vendor's observation time.
Nothing is computed locally, cross-filled from the journal, or copied from
user-reported settings.

## Explicit non-guarantees

- A `processing` or `unavailable` snapshot is not a zero and not a clean bill of
  health; it means the number is unknown.
- Figures follow the vendor's own computation schedule, so they may lag the broker
  account and are not a live read.
- MetaStats does not gate, arm or block execution.

## Tests

`src/lib/telemetry/__tests__/metastats.test.ts`,
`src/test/__tests__/docs-contract.test.ts`.

## Implementation

`src/lib/telemetry/metastats.ts`,
`src/lib/telemetry/collect.server.ts`, `src/lib/accounts/read.server.ts`.
