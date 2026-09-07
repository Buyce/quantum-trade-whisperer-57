# Why A and B setups are not being ordered, and whether C follows your rules

## What the records actually show (verified)

Your account's decisions, last 24 hours, counted per distinct setup:

| Grade | Queued | Refused |
| --- | --- | --- |
| A | 0 | 2 — Intelligence Gate (expected return below your floor) |
| B | 0 | 21 Intelligence Gate, 44 losing-run pause, 4 session not selected |
| C | 9 | 17 losing-run pause, 1 session |

So A and B are not blocked by grade. Three things stopped them:

1. **Your Intelligence Gate floor is above almost every measured cohort.** The gate judges a setup by the measured history of its own instrument and direction — it does not look at the grade at all. Your floor is 0.032R. Measured today:

```text
EURUSD long    +0.0915R   (passes)   <- your C-grade setups
EURUSD short   +0.0488R   (passes)
XAUUSD long    +0.0332R   (borderline)
XAUUSD short   +0.0268R   (refused)  <- most of your B-grade Gold setups
GBPAUD short   -0.0056R   (refused)  <- your A-grade setups
GBPAUD long    -0.1170R   (refused)
```

That is why A-grade GBPAUD is refused while C-grade EURUSD is accepted: the gate is measuring the pair and direction, not the quality grade.

2. **The losing-run pause** held 44 B-grade and 17 C-grade setups earlier today.

3. **Order window expiry.** Many refusals read "350 minutes old, window 360 minutes" — setups reached the check after the entry window had passed.

## Is C being queued correctly?

Yes, and it matches your settings: alert threshold C, C-grade automatic orders on, EURUSD selected, sessions matched, daily limit 50 not reached. Nine C setups were queued. What happened next at the broker:

- 6 rejected: "not enough money to complete the request"
- 2 accepted at the broker
- 1 rejected: unusable geometry (stop/target on the wrong side)

So the queueing is correct; most of those orders then failed at the broker for free margin.

## What I propose to build

### 1. A "why this grade is not trading" panel

On Settings, next to the Intelligence Gate, show the measured expected return for each instrument and direction against your current floor, with a plain pass/refuse mark. Read-only, from measured replay data — no estimates.

### 2. Make the grade/cohort conflict explicit

Where the gate refuses an A or B setup, the notice will say plainly that the refusal came from the pair-and-direction history, not the grade, so a high grade being refused is no longer confusing.

### 3. Surface the broker money rejections

Add a short notice on History when recent automatic orders were rejected for insufficient free margin, so it is visible without opening a table.

### 4. No rule changes without your say-so

I will not change your floor, your losing-run settings or your window. If you want more A/B orders, the direct levers are: lower the floor (or leave it blank), or widen the order window. Tell me which and I will set it.

## Technical notes

- Sources: `execution_enqueue_decisions`, `execution_deliveries`, `payoff_stats`, `scanner_settings`.
- The gate lives in `direct-enqueue.server.ts` and is evaluated on cohort `(instrument, direction)` after eligibility; no change to its logic is planned.
- Panel work is read-only display plus decision-copy wording; no gate, sizing, grading or risk maths is touched.
