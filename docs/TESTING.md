# Testing

## Purpose

Describe what the suite protects, and what a green run does and does not prove.

## Current behaviour

### Running

```sh
bun run test          # the BLOCKING vitest project only: UNIT + V1_CHARACTERIZATION
                      # + INVARIANT + db. This is the gate.
bun run test:report   # the NON-BLOCKING `report` project: [INTENDED_V2] tests in
                      # *.v2.test.ts, which describe desired future behaviour and
                      # are expected to fail against current V1. Never a gate.
bun run test:watch    # blocking project in watch mode
bunx vitest run path  # one file
bun run lint          # eslint + prettier over the repository
bun run lint:blocking # eslint + prettier over the test sources (part of verify)
bun run typecheck
bun run build
bun run verify        # lint:blocking -> typecheck -> blocking tests -> build
```

`bun run test` and `bun run test:report` are two different vitest projects, not a
short and long form of the same run. A green `verify` means the blocking project
passed; it says nothing about `test:report`, by design.

CI is defined in `.github/workflows/ci.yml`. No claim about a CI status check is
made in this documentation set — read the CI provider for that.

### Taxonomy

`src/test/__tests__/test-taxonomy.test.ts` enforces that every test declares its
kind, so nobody can quietly add a test that pins a defect while looking like a
specification:

| Kind             | Meaning                                                                            |
| ---------------- | ---------------------------------------------------------------------------------- |
| unit             | pure function behaviour                                                            |
| characterisation | **pins current V1 behaviour, including known defects** — not a statement of intent |
| invariant        | a rule that must never be violated (fail-closed, isolation, provenance)            |
| db               | runs against a real Postgres cluster                                               |

`src/test/__tests__/fixture-provenance.test.ts` enforces that every fixture states
where its data came from, so a synthetic candle set can never be mistaken for a
broker recording. Fixtures under `src/test/fixtures/pre-p7/` are the pre-Prompt-7
recordings used for characterisation.

### Database tests

Real Postgres via `src/test/db/start-cluster.sh` and `bootstrap.sql`; see
[DB-TESTS.md](DB-TESTS.md). These cover the guarantees that only SQL can enforce:
resolved-trade immutability, candidate cohort scoping, and model-version binding.

### What the suite deliberately protects

- Fail-closed refusals: sizing, FX staleness, execution controls, R availability.
- Provenance: agent-vs-human authorship, spec source, replay registry, R basis.
- Isolation: research and shadow rows never reach production reads.
- Truthfulness of copy: no empty result may claim a market condition.
- Truthfulness of documentation: `src/test/__tests__/docs-contract.test.ts` asserts
  the canonical production URL, absence of credentials/account ids and of the
  preview URL-as-production, resolvable internal doc links, MCP tool names matching
  `.lovable/mcp/manifest.json`, the execution-policy constant, and the documented
  instrument/timeframe lists against `src/lib/scanner/types.ts`.

- Zero-hallucination: no fixture path may write demo rows into production tables.

## Inputs

Recorded candle fixtures, deterministic seeds (the bootstrap seed is fixed), and
an ephemeral Postgres cluster for `db` tests.

## Outputs

Pass/fail per test, plus the taxonomy and fixture-provenance gates.

## Failure behaviour

A build error, a lint error or any failing test blocks the change. A
characterisation test failing means behaviour changed — decide deliberately
whether that change is wanted, then update the pin and
[CHARACTERISATION.md](CHARACTERISATION.md).

## User-facing meaning

None directly; the suite is a developer guarantee.

## What a green suite does not guarantee

- That the strategy is profitable. No test asserts an edge.
- That live MetaApi data is available or correct.
- That an external bridge behaves as documented.
- Out-of-sample validity — there is no holdout layer.

## Implementation

`vitest.config.ts`, `src/test/**`, `.github/workflows/ci.yml`.
