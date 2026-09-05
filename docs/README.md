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
6. [INSTRUMENT-LIFECYCLE.md](INSTRUMENT-LIFECYCLE.md)
7. [MULTI-ASSET.md](MULTI-ASSET.md) — asset classes, calendars, units and the Wave 2 disposition
8. [SIGNALS-AND-GRADES.md](SIGNALS-AND-GRADES.md)
9. [ALERTS-AND-ELIGIBILITY.md](ALERTS-AND-ELIGIBILITY.md)
10. [NEWS-AND-EVENTS.md](NEWS-AND-EVENTS.md) — official event sources, coverage states and the dark news policy

**Money and measurement**

11. [RISK-SIZING.md](RISK-SIZING.md)
12. [JOURNAL-AND-R.md](JOURNAL-AND-R.md)
13. [PERFORMANCE-AND-STATISTICS.md](PERFORMANCE-AND-STATISTICS.md)
14. [BROKER-EVIDENCE.md](BROKER-EVIDENCE.md)
15. [RESEARCH-AND-SHADOW.md](RESEARCH-AND-SHADOW.md)

**Integrations and operations**

16. [BROKER-ACCOUNTS.md](BROKER-ACCOUNTS.md)
17. [METASTATS.md](METASTATS.md)
18. [RISK-GUARDIAN.md](RISK-GUARDIAN.md)
19. [EXECUTION.md](EXECUTION.md)
20. [EXECUTION-QUALITY.md](EXECUTION-QUALITY.md) — drawdown brakes, execution-quality cooldowns and evidence-ranked cap ordering
21. [MCP.md](MCP.md)
22. [SECURITY.md](SECURITY.md)
23. [OPERATIONS.md](OPERATIONS.md)
24. [TESTING.md](TESTING.md)

**Audits and indexes**


- [LINK-AUDIT.md](LINK-AUDIT.md) — canonical URLs, internal link results and the
  vendor-guide audit behind the `/connect` steps.
- [audits/2026-08-23-prompt-14.md](audits/2026-08-23-prompt-14.md) — dated Prompt 14
  closure snapshot. Historical evidence for that checkout only; it does not describe
  verification status at HEAD.

**Historical**

- [CHARACTERISATION.md](CHARACTERISATION.md) — the V1 behaviour ledger, including
  pinned defects. Historical characterisation, not a statement of intent.
- [DB-TESTS.md](DB-TESTS.md) — the SQL regression layer.

## Document taxonomy and contract

Documents here are one of three kinds, and only the first carries the full
structural contract:

22. **Feature references** — every numbered document in the reading order above.
    Each opens with its purpose and then states current behaviour, inputs, outputs,
    provenance, failure behaviour, user-facing meaning, explicit non-guarantees,
    implementation files and tests. `src/test/__tests__/docs-contract.test.ts`
    enforces the parts that can be checked mechanically — provenance, explicit
    non-guarantees and named tests — rather than the presence of literal headings.
23. **Indexes and historical ledgers** — this file, `LINK-AUDIT.md`,
    `CHARACTERISATION.md` and `DB-TESTS.md`. They describe the documentation set, a
    frozen behaviour ledger, or a test layer rather than a shipped feature, so the
    feature-reference headings do not apply.
24. **Dated audit snapshots** — everything under `audits/`. Each is frozen evidence
    from a named date and is never retrofitted to HEAD. Excluded from the contract
    by design; adding empty headings to a historical record would falsify it.

Every document listed in this index resolves, and every implementation path it
cites exists — both checked mechanically rather than asserted as a count, because
a hardcoded document total drifts on the next commit.

## Writing rules for this documentation

- Never use "verified" without naming what was verified and by what.
- Never call a margin figure broker-exact; it is a margin estimate.
- Never present a confidence score as a win probability.
- Never present an empty signal list as proof that no valid setup exists.
- Never state a test count, table count or CI colour that is not read from the
  repository at the time of writing.
