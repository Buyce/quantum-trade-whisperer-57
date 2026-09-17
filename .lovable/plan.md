# Audit: why C-grade results look better than B-grade

## Short answer

The numbers in that panel are real, but they are not a fair grade comparison. I checked the 250 closed broker trades behind the table and found four concrete reasons the ranking is inverted, none of which mean "C setups are better than B setups".

## What the data actually shows

1. **The two grade groups traded different things.** B is dominated by short bets (Gold short 66 trades, GBP/AUD short 30), C is dominated by long bets (EUR/USD long 49, Gold long 19). Over these three weeks longs won and shorts lost, in every grade. So the table is mostly measuring direction and instrument mix, not grade quality.
2. **The money column is not risk-comparable.** Trade sizes range from about 0.7 lots to 12 lots and mix Gold with EUR/USD, so one large Gold trade moves the total more than twenty small ones. Adding money across different sizes and instruments cannot rank grades. Proof of the contradiction: C EUR/USD short shows +1711 money but an average result of -0.61 per unit of risk — the two columns point opposite ways.
3. **The two columns count different trades.** Of 250 trades, only 230 have a risk-based result; 20 (grades rebuilt after their setup row was purged) have money but no risk figure. Money totals include those rows, average risk figures exclude them, so the rows are not the same sample.
4. **The sample is too small, too clustered, and demo-only.** All 250 trades are demo, over three weeks, from 200 setups (several trades per setup, same day, same instrument, so results repeat rather than add evidence). Grade A has one single trade. The C-vs-B gap is roughly two standard errors before any adjustment — inside normal noise once clustering and mix are accounted for.

## Plan

### 1. Make the panel honest about what it compares
- Show grade rows split by direction and instrument, not one blended row per grade.
- Report result-per-unit-of-risk as the headline for quality, with money shown as a secondary, clearly labelled "not risk-comparable" figure.
- Show the risk-sample count next to every average, and state the trades excluded for having no risk figure.
- Label the whole block as demo evidence over its actual date range.
- Add a plain-language note: differences of this size across mixed instruments and directions are not evidence about grade quality.

### 2. Add a fair grade comparison
- Compare grades only within the same instrument and direction, then combine those like-for-like comparisons.
- Group repeated trades from the same setup so one setup counts once.
- Attach an uncertainty range and a minimum-evidence rule; below it, show "not enough evidence" instead of a ranking.

### 3. Audit the grading rule itself against this evidence
- Check whether the A/B/C thresholds actually separate outcomes once mix is controlled, using the existing replay and research-candidate records rather than only executed demo trades.
- Report the result as findings. No threshold change is applied in this pass; if the evidence says grading is mis-calibrated, that becomes its own proposal with holdout confirmation.

### 4. Cross-check the surrounding maths
- Verify the win definition, scratch handling, swap/commission signs, and the risk-per-trade denominator used in the average.
- Verify the recovered-grade rows are consistently excluded from every quality metric, not just some.
- Confirm the same reporting rules are used in the assistant, admin panels, and exports so all three agree.

## Technical notes

- Sources: `broker_trade_evidence` (closed rows, `r_vs_plan`, `r_availability`, `signal_grade`, `signal_grade_source`), aggregation in `src/lib/admin/trade-totals.ts`, rendering in `src/components/admin/AutoTraderPanel.tsx` and `TradeTotalsPanel.tsx`.
- Like-for-like comparison uses stratification by `broker_symbol` x `direction`, clustering by `coalesce(signal_id, signal_ref)`, and the existing clustered-bootstrap helpers already used for validation.
- No seeding, no synthetic rows; cohorts below the evidence floor render as unavailable.
