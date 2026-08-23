# Prompt 14 closure verification

## Scope

- Performance provenance and source separation;
- Broker Account / P-Trades Benchmark / My Journal UI;
- explicit `r_vs_plan` versus `r_vs_actual_risk` selection;
- versioned, default-off pooled-research consent UI;
- connected-account Guide and canonical documentation;
- local verification and a real demo-order smoke decision.

## Real MetaApi demo-order smoke

**Result: NOT RUN.**

Recorded on 2026-08-23 UTC. This checkout has browser-safe Supabase configuration
only. It does not have the server service-role credential, a MetaApi server token,
a broker-verified demo account context, or a dedicated smoke-only administrator
flag. Without all four, the test cannot prove demo-only routing or select the
broker's configured minimum volume. Sending any order would therefore violate the
fail-closed execution contract.

No live or demo order was attempted. No gate was enabled and no credential was
added. A future real smoke may be marked RUN only when an administrator can prove:

1. the broker itself classifies the target account as demo;
2. the account is ready, writable and explicitly armed for the smoke;
3. an explicit smoke/test flag is enabled for that single operation;
4. global live execution remains off;
5. the order volume equals the fresh broker-reported minimum and passes its step;
6. the broker acknowledgement and reconciliation evidence are retained, followed
   by an explicit close/cancel result.

## Local code gate

The canonical command is `bun run verify`; Bun is not installed in this
workspace, so the equivalent committed scripts were run with npm after an
install that did not rewrite either lockfile.

| Check                                            | Result on 2026-08-23 UTC                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                              | PASS                                                                                                                                |
| Production `npm run build`                       | PASS                                                                                                                                |
| Prompt 14 provenance/consent/docs targeted tests | PASS — 53 tests                                                                                                                     |
| Changed TypeScript/TSX ESLint set                | PASS                                                                                                                                |
| Full blocking test command                       | NOT PASS — 858 tests passed, but three database suites could not start because PostgreSQL `initdb` is unavailable in this workspace |
| Repository `lint:blocking` command               | NOT PASS — pre-existing Prettier findings remain in three Prompt 14 execution test files outside this change                        |

The database and repository-wide lint results are explicit infrastructure/
baseline blocks, not passes and not failures attributed to the new Performance or
consent code.
