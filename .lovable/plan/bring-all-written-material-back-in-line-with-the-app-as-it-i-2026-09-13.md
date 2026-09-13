# Bring all written material back in line with the app as it is today

Goal: anyone on your team opening the repository — or reading the in-app Guide —
gets a true picture of what P-Trades Hub does right now, where it is in its
rollout, and what is still open.

## What is actually out of date (checked, not assumed)

- **The exit-rule chapter contradicts the code.** `docs/EXECUTION.md` states that
  every exit choice is offered with "no platform depth ceiling", and that the
  platform ceiling "is retained in the schema but no longer read by dispatch".
  The pre-send check does read it and does reduce a customer's choice to it, which
  is exactly the bug fixed today.
- **The armed demo mode is undocumented.** Orders record the account's armed mode
  (not the bare word "demo"), and the managed part-close/stop-move steps depend on
  that distinction. It appears only inside a dated audit snapshot, nowhere in the
  living documentation.
- **The public position-size calculator page is missing** from the documentation
  and from the routes overview.
- **The roadmap mixes finished and open work**, still carries a superseded panel
  decision, and does not name what remains pending after publishing.

## The work

### 1. Truth pass over the canonical documents

- `docs/EXECUTION.md`: rewrite the exit-rule section to state what really happens —
  the customer chooses, the platform ceiling still applies as the emergency way to
  pull everyone back to the first target, its current value, and what happens when
  a choice is reduced. Document the armed demo mode as the condition for managed
  exits.
- `docs/BROKER-ACCOUNTS.md`: name the account modes as they are stored, and which
  of them count as demo money for managed exits and for automatic ordering.
- `docs/PRODUCT.md`, `docs/README.md`, `src/routes/README.md`: add the public
  calculator page and confirm every page listed still exists.
- `docs/OPERATIONS.md`: confirm the scanner-reliability wording matches the current
  worker behaviour (bounded waits, hard pass deadline, cancellation, shared
  market-data budget, health read from real worker passes), and add the one
  outstanding item: live observation over four consecutive market hours.
- `docs/INSTRUMENT-LIFECYCLE.md`: confirm the ladder is promote-or-hold only and
  that nothing automatic can move an instrument down.
- `README.md`: re-verify the "current production scope" table line by line against
  the code it cites — instrument set, cadence, retention, order lifetime, caps,
  exit rules, live-execution state — and correct anything that has drifted.
- `docs/GLOSSARY.md`, `docs/RESEARCH-AND-SHADOW.md`: fix the places that describe
  the first target as the only exit rule in force.

### 2. Where we are, in one place

- Rewrite `roadmap.md` as a lean current-state list: what is live, what is measured
  but not yet trusted, what is switched off on purpose, and the genuinely open
  items with their blockers. Finished history stays in the dated archive rather
  than the working list.
- Add a short "state of play" section at the top of `README.md`: rollout stage per
  instrument, what automatic ordering is allowed to do today, and what a new team
  member should read first.

### 3. In-app wording

- Guide and Settings help text for exit rules, brakes and the same-bet limit
  reworded to match the behaviour after today's fix, including what a
  platform-reduced choice means for the customer.

### 4. Code-side readability

- Comment sweep over the files touched in the recent execution, scanner-reliability
  and lifecycle work: each file's opening comment says what it owns and what it
  refuses to do; stale comments that describe removed behaviour are corrected.
- Repository-wide formatting run so indentation and wrapping are uniform.

### 5. Contributor instructions

- `AGENTS.md` and `docs/TESTING.md` / `docs/DB-TESTS.md`: confirm the described
  commands, test classes and database-test setup are the ones that actually work,
  and state the rules a contributor must not break (no invented data, no seeding of
  signals or trades, migrations for schema and query tools for rows, grants and
  row-level security on every new table).

## Technical notes

- The documentation-contract test (`src/test/__tests__/docs-contract.test.ts`)
  enforces structure and truthfulness on `README.md`, `AGENTS.md` and `docs/**`;
  every edit is validated against it, and dated audit snapshots under
  `docs/audits/**` are left untouched as historical evidence.
- Verification: documentation-contract tests, full test suite, typecheck,
  formatter, production build.
- No behavioural code changes in this pass — comments, formatting and prose only.
