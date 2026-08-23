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

Implementation: `src/lib/telemetry/metastats.ts`,
`src/lib/telemetry/collect.server.ts`, `src/lib/accounts/read.server.ts`.
