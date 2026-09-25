/**
 * Deterministic rule-conflict checks for the setup explainer. Computed in code
 * from the trader's real settings — the model only explains them, it never
 * decides them. Missing inputs are reported as unknown, never assumed.
 */
const GRADE_RANK: Record<string, number> = { C: 1, B: 2, A: 3, "A+": 4 };

export interface ExplainSettings {
  instruments: string[] | null;
  min_grade: string | null;
  max_stop_loss_percent: number | null;
  risk_per_trade_percent: number | null;
}

export interface ExplainSetup {
  instrument: string | null;
  direction: "long" | "short" | null;
  grade: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
}

export interface RuleCheck {
  rule: string;
  status: "conflict" | "ok" | "unknown";
  detail: string;
}

export function checkRules(
  setup: ExplainSetup,
  settings: ExplainSettings | null,
  cohortPolicy: { policy: string; risk_share_percent: number } | null,
): RuleCheck[] {
  const out: RuleCheck[] = [];
  const { entry, stop, target, direction } = setup;

  if (entry !== null && stop !== null && direction) {
    const wrongSide = direction === "long" ? stop >= entry : stop <= entry;
    out.push({
      rule: "Stop on the correct side of entry",
      status: wrongSide ? "conflict" : "ok",
      detail: wrongSide
        ? `A ${direction} stop must be ${direction === "long" ? "below" : "above"} entry.`
        : "Stop geometry is valid.",
    });
    if (target !== null) {
      const tWrong = direction === "long" ? target <= entry : target >= entry;
      const risk = Math.abs(entry - stop);
      const rr = risk > 0 ? Math.abs(target - entry) / risk : null;
      out.push({
        rule: "Target on the correct side of entry",
        status: tWrong ? "conflict" : "ok",
        detail: tWrong
          ? "Target is on the losing side of entry."
          : rr !== null
            ? `Reward-to-risk ≈ ${rr.toFixed(2)}R.`
            : "Target geometry is valid.",
      });
    }
    if (settings?.max_stop_loss_percent != null && entry > 0) {
      const pct = (Math.abs(entry - stop) / entry) * 100;
      const over = pct > settings.max_stop_loss_percent;
      out.push({
        rule: "Stop distance within your limit",
        status: over ? "conflict" : "ok",
        detail: `Stop is ${pct.toFixed(2)}% from entry; your limit is ${settings.max_stop_loss_percent}%.`,
      });
    }
  } else {
    out.push({
      rule: "Stop geometry",
      status: "unknown",
      detail: "Rule checks run on P-Trades signals. Pasted notes are explained by the AI but not checked against your settings.",
    });
  }

  if (setup.instrument && settings?.instruments) {
    const on = settings.instruments.includes(setup.instrument);
    out.push({
      rule: "Instrument in your selection",
      status: on ? "ok" : "conflict",
      detail: on
        ? `${setup.instrument} is one of your instruments.`
        : `${setup.instrument} is not in your selected instruments.`,
    });
  }

  if (setup.grade && settings?.min_grade) {
    const ok = (GRADE_RANK[setup.grade] ?? 0) >= (GRADE_RANK[settings.min_grade] ?? 0);
    out.push({
      rule: "Grade meets your minimum",
      status: ok ? "ok" : "conflict",
      detail: `Grade ${setup.grade} vs your minimum ${settings.min_grade}.`,
    });
  }

  if (cohortPolicy) {
    out.push({
      rule: "Your automatic-trading rule for this instrument and direction",
      status: cohortPolicy.policy === "block" ? "conflict" : "ok",
      detail:
        cohortPolicy.policy === "block"
          ? "You blocked automatic orders for this instrument and direction."
          : cohortPolicy.policy === "reduce"
            ? `Automatic orders here use ${cohortPolicy.risk_share_percent}% of normal risk.`
            : "Allowed.",
    });
  }

  if (!settings) {
    out.push({ rule: "Your settings", status: "unknown", detail: "Settings could not be read." });
  }
  return out;
}
