# P-Trades Hub documentation

Canonical documentation for the implementation at HEAD. Where this set and any
older document disagree, **the code is the authority** — then this set, then
everything else.

`.lovable/plan/**` is a historical record of decisions. It is not documentation
and is never updated retroactively.

## Reading order

**Start here**

1. [PRODUCT.md](PRODUCT.md) — what the terminal is for and how a user works with it.
2. [GLOSSARY.md](GLOSSARY.md) — the canonical vocabulary. Read this before the rest.
3. [DATA-PROVENANCE.md](DATA-PROVENANCE.md) — where every number comes from.

**The engine**

4. [ARCHITECTURE.md](ARCHITECTURE.md)
5. [SCANNER.md](SCANNER.md)
6. [SIGNALS-AND-GRADES.md](SIGNALS-AND-GRADES.md)
7. [ALERTS-AND-ELIGIBILITY.md](ALERTS-AND-ELIGIBILITY.md)

**Money and measurement**

8. [RISK-SIZING.md](RISK-SIZING.md)
9. [JOURNAL-AND-R.md](JOURNAL-AND-R.md)
10. [PERFORMANCE-AND-STATISTICS.md](PERFORMANCE-AND-STATISTICS.md)
11. [RESEARCH-AND-SHADOW.md](RESEARCH-AND-SHADOW.md)

**Integrations and operations**

12. [EXECUTION.md](EXECUTION.md)
13. [MCP.md](MCP.md)
14. [SECURITY.md](SECURITY.md)
15. [OPERATIONS.md](OPERATIONS.md)
16. [TESTING.md](TESTING.md)
17. [LINK-AUDIT.md](LINK-AUDIT.md) — canonical URLs, internal link results and the
    vendor-guide audit behind the `/connect` steps.

**Historical**

- [CHARACTERISATION.md](CHARACTERISATION.md) — the V1 behaviour ledger, including
  pinned defects. Historical characterisation, not a statement of intent.
- [DB-TESTS.md](DB-TESTS.md) — the SQL regression layer.

## Document contract

Every document in this set states: purpose, current behaviour, inputs, outputs,
provenance, failure behaviour, user-facing meaning, explicit non-guarantees,
implementation files and tests.

## Writing rules for this documentation

- Never use "verified" without naming what was verified and by what.
- Never call a margin figure broker-exact; it is a margin estimate.
- Never present a confidence score as a win probability.
- Never present an empty signal list as proof that no valid setup exists.
- Never state a test count, table count or CI colour that is not read from the
  repository at the time of writing.
