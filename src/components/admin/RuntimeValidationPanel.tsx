import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listValidationAccounts, runRuntimeValidationFn } from "@/lib/validation.functions";
import type { ValidationReport } from "@/lib/validation/report";

const fmt = (v: number | null, d = 2) =>
  v === null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: d });

export function RuntimeValidationPanel() {
  const list = useServerFn(listValidationAccounts);
  const run = useServerFn(runRuntimeValidationFn);
  const accounts = useQuery({ queryKey: ["runtime-validation-accounts"], queryFn: () => list() });
  const [selected, setSelected] = useState<string[]>([]);
  const [symbol, setSymbol] = useState("EURUSD");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [stop, setStop] = useState("0.0020");
  const mutation = useMutation({
    mutationFn: () =>
      run({ data: { accountIds: selected, symbol, direction, stopDistance: Number(stop) } }),
  });

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <section className="rounded-sm border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">Runtime validation</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Dry run — no order sent, no settings changed. Only the broker margin calculator is called.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(accounts.data ?? []).map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={!a.connected}
            onClick={() => toggle(a.id)}
            className={`rounded-sm border px-2 py-1 text-xs ${selected.includes(a.id) ? "border-primary bg-primary/10" : "border-border"} disabled:opacity-40`}
          >
            {a.label} · {a.accountType ?? "?"}
          </button>
        ))}
        {accounts.isLoading ? (
          <span className="text-xs text-muted-foreground">Loading…</span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <Input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          aria-label="Symbol"
        />
        <select
          aria-label="Direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value as "long" | "short")}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>
        <Input
          value={stop}
          onChange={(e) => setStop(e.target.value)}
          aria-label="Stop distance (price)"
        />
        <Button
          disabled={selected.length === 0 || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Validating…" : "Validate"}
        </Button>
      </div>

      {mutation.error ? (
        <p className="mt-2 text-xs text-destructive">{(mutation.error as Error).message}</p>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {(mutation.data ?? []).map((r) => (
          <ReportCard key={r.account_id} r={r} />
        ))}
      </div>
    </section>
  );
}

function ReportCard({ r }: { r: ValidationReport }) {
  return (
    <div className="rounded-sm border border-border p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{r.label ?? r.account_id}</span>
        <Badge variant={r.passed ? "secondary" : "destructive"}>{r.passed ? "PASS" : "FAIL"}</Badge>
      </div>
      <p className="mt-1 text-muted-foreground">
        {r.classification ?? "unclassified"} · {r.connection_state ?? "—"} · observed{" "}
        {r.broker_observed_at ? new Date(r.broker_observed_at).toUTCString() : "—"}
      </p>
      <p className="mt-1">
        Balance {fmt(r.balance)} · Equity {fmt(r.equity)} · Free margin {fmt(r.free_margin)}{" "}
        {r.currency ?? ""}
      </p>
      <p className="mt-1">
        Policy {r.policy_id?.slice(0, 8) ?? "—"} · risk {fmt(r.risk_percent)}% ={" "}
        {fmt(r.risk_amount)} · {r.canonical_symbol}→{r.broker_symbol ?? "—"} · {fmt(r.lots, 2)} lots
        · margin {fmt(r.required_margin)}
      </p>
      <ul className="mt-2 space-y-0.5">
        {r.gates.map((g) => (
          <li key={g.gate} className="flex gap-2">
            <span
              className={
                g.status === "PASS"
                  ? "text-foreground"
                  : g.status === "FAIL"
                    ? "text-destructive"
                    : "text-muted-foreground"
              }
            >
              {g.status}
            </span>
            <span>{g.gate}</span>
            {g.reason ? <span className="text-muted-foreground">— {g.reason}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
