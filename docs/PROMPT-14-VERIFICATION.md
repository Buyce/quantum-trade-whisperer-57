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
workspace, so the exact local binaries behind the committed scripts were run
without changing the Bun lockfile.

| Check                                            | Result on 2026-08-23 UTC                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript `tsc --noEmit`                        | PASS                                                                                                                                |
| Production Vite/Cloudflare build                 | PASS, with documented dependency/deprecation warnings                                                                               |
| Prompt 14 provenance/consent/docs targeted tests | PASS — 138 tests                                                                                                                    |
| Quantitative/model targeted tests                | PASS — 319 tests                                                                                                                    |
| Repository `lint:blocking` equivalent            | PASS; the gate now includes evidence, MetaApi and sizing tests                                                                      |
| Full blocking test command                       | NOT PASS — 872 non-database tests passed; 39 database tests in three suites were NOT RUN because PostgreSQL `initdb` is unavailable |
| Full repository ESLint                           | NOT PASS — 3,337 findings remain (3,317 Prettier errors and 20 Fast Refresh warnings); no semantic/type-safety lint errors remain    |

The database and repository-wide lint results are explicit infrastructure or
baseline blocks, not passes. A green production release still requires the three
database suites on PostgreSQL, a mechanical formatting pass, and a documented
decision on the remaining Fast Refresh file-boundary warnings.

## Public production smoke

| Surface                                              | Result                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `https://getptrades.com/`                            | PASS — landing page rendered                                                                             |
| `/auth`                                              | PASS — signed-out authentication route rendered                                                          |
| `/connect`                                           | PASS — guide and MCP URL rendered                                                                        |
| `/.well-known/oauth-protected-resource`              | PASS — OAuth resource metadata returned                                                                  |
| Unauthenticated MCP initialization                   | PASS — `401` with a Bearer challenge and protected-resource metadata                                     |
| Authenticated terminal, MCP tools and broker actions | NOT RUN — no test account, OAuth grant, service-role credential or isolated broker-verified demo context |
