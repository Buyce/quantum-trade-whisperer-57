# P-Trades Hub — Investor Pitch Deck (downloadable)

A polished PowerPoint deck built from the real database as of today, plus a
10-point marketing sheet inside the deck. Honest but forward-leaning: every
figure is a number the system actually holds, gaps are framed as the next
few weeks of work.

## Verified numbers the deck will use (queried today)

| Metric | Value |
|---|---|
| First signal captured | 11 Aug 2026 (≈3.5 weeks live) |
| Published setups | 432 across 15 scanning days |
| Grade mix | 7 high grade (A+/A), 223 B, 202 C |
| Instruments publishing | 3 (EURUSD, GBPAUD, XAUUSD); 12 instruments tracked in the lifecycle registry |
| Deterministic replays | 1,732 rows, 1,615 resolved |
| Production replays | 1,097 resolved |
| Research candidates captured pre-publication | 1,641 |
| Research replays | 624 rows, 518 resolved |
| Broker order deliveries | 541 |
| Broker trade evidence rows | 118, with 122 order associations |
| Connected trading accounts | 15 |
| Model observations logged | 7,799 |
| Broker API observations | 198,622 |
| Spread statistics rows | 342 |
| Execution-quality scores | 33 |
| Filter comparison rows | 109 |
| Walk-forward confirmations | 8 |
| Regime / payoff stat rows | 94 / 14 |
| Economic events ingested | 46 |
| Automated test files | 146 (1,590+ checks green) |
| Users on the platform | 5 |

Nothing outside this table (market size, revenue, valuation, ARR) will be
invented. Where the deck needs a commercial figure it shows a clearly marked
placeholder such as `[RAISE AMOUNT — replace]` for you to fill in.

## Deck structure (14 slides)

1. Title — P-Trades Hub, autonomous FX scanner and trade assistant, date.
2. The problem — discretionary traders have no honest measurement layer.
3. The product — scan, grade, plan, size, decide, measure.
4. What was built since day one — the six-layer stack in one diagram.
5. Traction in numbers — the big stat callouts from the table above.
6. The 10 marketing points — two slides, five points each, each with its figure.
7. Our unfair advantage — provenance discipline: nothing seeded, nothing
   fabricated, every number labelled by source; that is what lets the engine
   be trusted with real money.
8. Evidence engine — pre-publication research capture (1,641 candidates)
   defeats selection bias; walk-forward holdout gates any rule change.
9. Risk and control plane — drawdown brakes, execution-quality cooldowns,
   adaptive spread limits, signed webhook delivery, owner confirmation.
10. Where we are honest — live execution still off by design; most learning
    verdicts read "not yet decidable" until evidence clears the bar.
11. Next 6 weeks — drain the remaining ~112 pending research replays, clear
    the descriptive evidence bar on filter comparisons, promote instruments
    out of data validation, first gated live-order rollout, exit-variant
    verdict from replay paths.
12. Business model — subscription tiers as placeholders for your pricing.
13. The ask — placeholder raise, runway and use of funds.
14. Close — contact and the getptrades.com domain.

## The 10 marketing points (each carries a real number)

1. Selective by design — 432 setups in 15 days, only 7 graded A+/A.
2. 1,615 deterministic replays resolved; every setup judged against real candles.
3. 1,641 structures captured *before* publication — selection bias measured, not assumed.
4. 198,622 broker API observations; the engine runs on live broker data only.
5. 541 order deliveries and 118 broker-verified trade records — an audited execution trail.
6. 15 connected broker accounts already reading real account facts.
7. 7,799 model observations feeding a versioned learning engine.
8. Risk brakes measured from broker equity, not guesses — daily, weekly and drawdown limits.
9. 342 spread samples power adaptive entry limits per instrument and session.
10. 146 test files and 1,590+ automated checks — a financial control plane, not a prototype.

## Technical notes

- Generated with pptxgenjs to `/mnt/documents/p-trades-investor-deck.pptx`.
- Palette: Midnight Executive (navy `1E2761`, ice `CADCFC`, white accent) to
  match the existing dark terminal look; the P-Trades mark used on the title slide.
- Numbers are pulled from the live database at generation time and hardcoded
  into the deck file (a deck is a snapshot, not a live view). The date the
  figures were read is printed on the traction slide.
- Validated with the office validator, converted to images, and every slide
  visually inspected before delivery.
- No project source files change.
