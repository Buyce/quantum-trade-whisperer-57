/**
 * Per-account risk policy setup. Every order on this account is re-checked
 * against these limits right before sending; nothing here places an order.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ConnectedAccountView } from "@/lib/accounts/types";
import { riskPolicyInput, saveAccountRiskPolicy } from "@/lib/accounts/risk-policy.functions";

type Kind = "standard" | "equity_edge_instant_50k";

const PRESET = {
  kind: "equity_edge_instant_50k" as Kind,
  startingBalance: "50000",
  operating: "0.25",
  hard: "1",
  daily: "3",
  total: "5",
  trailing: true,
  trades: "2",
  objective: "200",
};

function s(v: number | null | undefined) {
  return v === null || v === undefined ? "" : String(v);
}
function n(v: string): number | null {
  if (v.trim() === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}

export function RiskPolicyForm({
  account,
  onSaved,
}: {
  account: ConnectedAccountView;
  onSaved: () => void;
}) {
  const p = account.riskPolicy;
  const [open, setOpen] = useState(!p);
  const [kind, setKind] = useState<Kind>(p?.kind ?? "standard");
  const [startingBalance, setStartingBalance] = useState(
    s(p?.startingBalance ?? account.broker.balance),
  );
  const [operating, setOperating] = useState(s(p?.operatingRiskPerTradePercent ?? 0.5));
  const [hard, setHard] = useState(s(p?.hardRiskPerTradePercent ?? 1));
  const [daily, setDaily] = useState(s(p?.maxDailyLossPercent));
  const [total, setTotal] = useState(s(p?.maxTotalLossPercent));
  const [trailing, setTrailing] = useState(p?.trailingDrawdown ?? false);
  const [trades, setTrades] = useState(s(p?.maxTradesPerDay));
  const [objective, setObjective] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useServerFn(saveAccountRiskPolicy);
  const mutation = useMutation({
    mutationFn: (data: unknown) => save({ data }),
    onSuccess: () => {
      toast.success("Risk policy saved");
      setOpen(false);
      onSaved();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save"),
  });

  const applyPreset = () => {
    setKind(PRESET.kind);
    setStartingBalance(PRESET.startingBalance);
    setOperating(PRESET.operating);
    setHard(PRESET.hard);
    setDaily(PRESET.daily);
    setTotal(PRESET.total);
    setTrailing(PRESET.trailing);
    setTrades(PRESET.trades);
    setObjective(PRESET.objective);
  };

  const submit = () => {
    setError(null);
    const parsed = riskPolicyInput.safeParse({
      accountId: account.id,
      kind,
      startingBalance: n(startingBalance),
      operatingRiskPerTradePercent: n(operating),
      hardRiskPerTradePercent: n(hard),
      maxDailyLossPercent: n(daily),
      maxTotalLossPercent: n(total),
      trailingDrawdown: trailing,
      maxTradesPerDay: n(trades),
      dailyProfitObjective: n(objective),
      newsTradingAllowed: p?.newsTradingAllowed ?? null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the values");
      return;
    }
    const live = account.mode === "live_auto" || account.mode === "live_confirm";
    if (
      live &&
      !window.confirm("This account trades real money. Apply the new limits to the next order?")
    )
      return;
    mutation.mutate(parsed.data);
  };

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    hint?: string,
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`${account.id}-${id}`} className="text-xs">
        {label}
      </Label>
      <Input
        id={`${account.id}-${id}`}
        inputMode="decimal"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={hint ?? "Off"}
      />
    </div>
  );

  return (
    <div className="border-t border-border p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium">Risk policy</p>
          <p className="text-muted-foreground">
            {p
              ? `${p.operatingRiskPerTradePercent}% per trade · hard cap ${p.hardRiskPerTradePercent}%`
              : "Not set — automatic orders stay blocked until you set one."}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : p ? "Edit" : "Set up"}
        </Button>
      </div>

      {open ? (
        <div className="mt-3 space-y-3">
          <Button size="sm" variant="secondary" onClick={applyPreset}>
            Use Equity Edge Instant 50K preset
          </Button>
          <div className="grid grid-cols-2 gap-3">
            {field("bal", "Starting balance", startingBalance, setStartingBalance, "e.g. 50000")}
            {field("op", "Normal risk per trade %", operating, setOperating)}
            {field("hard", "Hard cap per trade %", hard, setHard)}
            {field("trades", "Max trades per day", trades, setTrades)}
            {field("daily", "Max daily loss %", daily, setDaily)}
            {field("total", "Max total loss %", total, setTotal)}
            {field("obj", "Stop after daily profit", objective, setObjective)}
          </div>
          <label className="flex items-center gap-2">
            <Switch checked={trailing} onCheckedChange={setTrailing} />
            Total loss limit trails your highest balance
          </label>
          <p className="text-muted-foreground">
            Blank fields mean no limit. Every order is re-checked against these limits right
            before it is sent.
          </p>
          {error ? <p className="text-destructive">{error}</p> : null}
          <Button size="sm" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save risk policy"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
