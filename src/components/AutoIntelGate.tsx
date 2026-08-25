/**
 * Optional intelligence gate for AUTOMATIC ORDERS ONLY.
 *
 * Two honesty rules govern this control's wording:
 *  - The rate is the replay-derived share of FILLED setups in the same regime
 *    that reached the first target. It is a historical measurement, not a
 *    forecast, and the copy never calls it a probability of profit.
 *  - A regime with too few resolved samples is REFUSED, not passed. The user is
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
  onEnabledChange: (v: boolean) => void;
  onMinWinPctChange: (v: string) => void;
  onMinSampleChange: (v: string) => void;
}

export function AutoIntelGate(props: AutoIntelGateProps) {
  const { enabled, minWinPct, minSample } = props;
  const pct = Number(minWinPct);
  const configured = enabled && Number.isFinite(pct) && pct > 0;

  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="label-xs">Intelligence gate (automatic orders only)</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Off by default. When on, an eligible setup only becomes an order if the historical
            win-if-filled rate for its own regime — same instrument, direction, session and
            volatility bucket, from resolved replay outcomes — meets your threshold. It never
            changes your feed, your alerts or any statistic.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={props.onEnabledChange} />
      </div>

      {enabled ? (
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
              placeholder="e.g. 55"
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
      ) : null}

      {enabled && !configured ? (
        <p className="text-xs text-warning">
          Set a threshold above 0% for the gate to do anything. Until then it is treated as
          unconfigured and refuses nothing.
        </p>
      ) : null}

      {configured ? (
        <p className="text-xs text-muted-foreground">
          A regime with fewer than {Number(minSample) > 0 ? Number(minSample) : 1} resolved filled
          samples is refused, not passed — P-Trades will not place an order on a rate it has not
          actually measured. Refusals appear in your decision log with the numbers behind them.
        </p>
      ) : null}
    </section>
  );
}
