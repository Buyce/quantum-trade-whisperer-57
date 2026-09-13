# Make the data readable, describable and exportable

Today the shape of the data is safe but under-documented: 186 migrations in the
repository define every table, function and policy, the busy tables carry
indexes, and rows exist for signals (823), shadow replay (3,086), research
candidates (2,780), model observations (11,228), broker evidence (211) and
execution decisions (186,928). What is missing is meaning: almost no table or
column carries a written description, there is no single data dictionary, and
there is no way to pull a clean training dataset out of the app.

## What you will get

1. **A data dictionary** — one document listing every table, what it records,
   who may read it, and what each meaningful column means, grouped by area
   (signals, shadow replay, research, learning statistics, broker evidence,
   execution, market context, news, operations).
2. **Descriptions stored in the database itself** — each table and each
   meaningful column gets a permanent description, so any teammate or tool that
   inspects the database sees the same explanation without opening the docs.
3. **Training exports, downloadable from the app** — an owner-only Admin section
   that builds and downloads dataset files:
   - **Signals** — every published setup with grade, instrument, session,
     geometry, target ladder and provenance stamps.
   - **Shadow replay outcomes** — each replayed structure with its model
     version, execution policy, resolved path and outcome, which is the labelled
     set a model trains on.
   - **Research candidates** — pre-publication structures with their gate
     records and rejection reasons, so rejected cases stay in the training set.
   - **Broker-verified trades** — closed trades with realised R and net result.
   - **Learning statistics** — payoff, regime, spread and filter-lift summaries.
   Each dataset downloads as CSV and as JSON lines, and every export carries a
   companion description file naming the columns, the row count, the time window
   and the provenance class of each field.
4. **Read-only data access for your team's AI** — the app already publishes an
   assistant connection (14 tools, sign-in required, some of which can write
   settings and journal entries). This adds a separate read-only research
   surface for team AI tools:
   - New read-only tools that return the same datasets as the exports:
     signals, shadow replay outcomes, research candidates, learning statistics
     and platform-wide broker-verified results, with filters for instrument,
     grade, model version and date window, and paging so a chatbot can walk
     large sets.
   - Owner-restricted: platform-wide research reads are refused unless the
     signed-in account is an owner, so a customer's assistant still sees only
     its own account.
   - Read-only by construction: these tools contain no write path at all, and
     the existing write tools stay untouched and out of this surface.
   - Any AI tool that speaks the standard assistant protocol (ChatGPT, Claude,
     Cursor, your own chatbot) can connect with a sign-in, and each returned
     field carries its provenance label so a model cannot mistake a replay
     result for a broker fill.
5. **A team access guide** — how your team reaches everything: the repository
   for schema, functions and application code; the Cloud data export for a full
   database copy; the exports above for training files; and the read-only
   assistant connection for live reads.


## Rules the exports follow

- Only real recorded rows are exported. Nothing is generated, filled in or
  smoothed, and an empty window exports an empty file with its row count stated.
- Every field keeps its provenance class (broker-derived, engine-derived,
  replay-derived, self-reported, estimate), so another model cannot mistake a
  replay result for a broker fill.
- Exports are owner-only and contain no account credentials, bridge secrets,
  email addresses or broker login numbers.

## What your team can and cannot get from GitHub

The repository holds the complete definition of the system: every table, index,
policy, database function, cron schedule, scanner and learning code, tests and
documentation. It does **not** hold the rows — production data lives only in the
database. So the answer to "can my team access the data on GitHub" is: they get
the structure and the logic there, and the data through the Cloud data export or
the new training exports. The guide will spell this out with the exact steps.

## Technical notes

- Descriptions are added with `COMMENT ON TABLE` / `COMMENT ON COLUMN` in one
  additive migration; no column, type or policy changes.
- Export queries run as owner-gated server functions using service-role reads
  with explicit column projections and a time-window bound, aggregating in SQL
  so nothing is truncated by row caps.
- New Admin panel renders dataset choice, window, row counts and download
  buttons, reusing the existing CSV helpers in `src/lib/export.ts`.
- New tests cover column-projection safety (no secret columns), provenance
  labelling and empty-window behaviour; `docs/DATA-PROVENANCE.md`,
  `docs/OPERATIONS.md` and the README index are updated, and the docs-contract
  test is extended to keep the dictionary honest.
