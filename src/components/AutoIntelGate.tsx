/**
 * Optional intelligence gate for AUTOMATIC ORDERS ONLY.
 *
 * Two measures, both optional and independent:
 *  - Expected return per setup (in R), averaged over the whole payoff
 *    distribution with never-traded plans counted as 0R. This is the money
 *    measure and is offered first, because a hit rate on its own says nothing
 *    about how much is won or lost per trade.
 *  - Win-if-filled rate, a hit-rate measure kept as a secondary filter.
 *
 * Two honesty rules govern this control's wording:
 *  - Both figures are historical measurements from resolved replay outcomes, not
 *    forecasts, and the copy never calls either a probability of profit.
 *  - A cohort with too few resolved samples is REFUSED, not passed. The user is
 *    told this plainly, because a gate that quietly waves through unmeasured
 *    setups would be worse than no gate.
 *
 * It can only reduce what is sent; it can never authorise an order that the
 * ordinary rules or the downstream safety gates would refuse.
 */
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface AutoIntelGateProps {
  enabled: boolean;
  minWinPct: string;
  minSample: string;
  minExpectedR: string;
  onEnabledChange: (v: boolean) => void;
  onMinWinPctChange: (v: string) => void;
  onMinSampleChange: (v: string) => void;
  onMinExpectedRChange: (v: string) => void;
}

export function AutoIntelGate(props: AutoIntelGateProps) {
  const { enabled, minWinPct, minSample, minExpectedR } = props;
  const pct = Number(minWinPct);
  const winConfigured = enabled && Number.isFinite(pct) && pct > 0;
  const expectedRConfigured =
    enabled && minExpectedR.trim() !== "" && Number.isFinite(Number(minExpectedR));
  const configured = winConfigured || expectedRConfigured;

  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="label-xs">Intelligence gate (automatic orders only)</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Off by default. When on, an eligible setup only becomes an order if the measured
            history of its own cohort — same instrument and direction, from resolved replay
            outcomes — clears the thresholds you set below. It never changes your feed, your
            alerts or any statistic.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={props.onEnabledChange} />
      </div>

      {enabled ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="intel-er" className="text-xs">
              Minimum expected return per setup (R)
            </Label>
            <Input
              id="intel-er"
              inputMode="decimal"
              value={minExpectedR}
              onChange={(e) => props.onMinExpectedRChange(e.target.value)}
              placeholder="e.g. 0.05 — leave blank to skip this check"
            />
            <p className="text-[11px] text-muted-foreground">
              This is the money measure: the average R per published plan, counting plans that
              never traded as exactly 0R. A cohort also has to have a measured range that is not
              entirely below zero. Leave blank and this check refuses nothing.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="intel-win" className="text-xs">
                Minimum win-if-filled rate (%)
              </Label>
              <Input
                id="intel-win"
                inputMode="decimal"
                value={minWinPct}
                onChange={(e) => props.onMinWinPctChange(e.target.value)}
                placeholder="e.g. 55 — leave blank to skip this check"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="intel-sample" className="text-xs">
                Minimum filled samples behind that rate
              </Label>
              <Input
                id="intel-sample"
                inputMode="numeric"
                value={minSample}
                onChange={(e) => props.onMinSampleChange(e.target.value)}
                placeholder="30"
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            A hit rate on its own does not say how much is won or lost per trade, so a high
            win-rate threshold can block cohorts that actually made money and allow ones that
            lost it. If you use only one of the two checks, use the expected-return one.
          </p>
        </div>
      ) : null}

      {enabled && !configured ? (
        <p className="text-xs text-warning">
          Set an expected-return floor or a win-rate threshold above 0% for the gate to do
          anything. Until then it is treated as unconfigured and refuses nothing.
        </p>
      ) : null}

      {winConfigured ? (
        <p className="text-xs text-muted-foreground">
          A regime with fewer than {Number(minSample) > 0 ? Number(minSample) : 1} resolved filled
          samples is refused, not passed — P-Trades will not place an order on a rate it has not
          actually measured. The stricter the rate and the sample floor, the fewer instruments and
          directions can currently qualify at all; refusals appear in your decision log with the
          numbers behind them.
        </p>
      ) : null}

      {expectedRConfigured ? (
        <p className="text-xs text-muted-foreground">
          A cohort with no reportable expected-return measurement is refused, not passed, and its
          refusal is recorded with the numbers behind it. Admin → Intelligence shows how each
          cohort's replay measurement compares with what the broker actually paid.
        </p>
      ) : null}
    </section>
  );
}
