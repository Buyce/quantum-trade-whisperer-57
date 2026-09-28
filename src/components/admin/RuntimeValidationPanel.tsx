import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { runRuntimeValidation } from "@/lib/runtime-validation.functions";

export function RuntimeValidationPanel() {
  const run = useServerFn(runRuntimeValidation);
  const [accountId, setAccountId] = useState("");
  const [symbol, setSymbol] = useState("EURUSD");
  const [volume, setVolume] = useState("0.01");
  const [price, setPrice] = useState("");
  const [side, setSide] = useState<"ORDER_TYPE_BUY" | "ORDER_TYPE_SELL">("ORDER_TYPE_BUY");
  const validation = useMutation({
    mutationFn: () =>
      run({
        data: {
          accountId: accountId.trim(),
          logicalSymbol: symbol.trim().toUpperCase(),
          actionType: side,
          volume: Number(volume),
          openPrice: Number(price),
        },
      }),
  });

  return (
    <section className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Owner-only dry run. Validates account policy, symbol/volume and MetaApi margin. It cannot
        arm Live Confirm/Live Auto and has no broker trade endpoint.
      </p>
      <div className="grid gap-2 md:grid-cols-5">
        <input\n          className="rounded border bg-background px-2 py-1 text-sm"\n          value={accountId}\n          onChange={(e) => setAccountId(e.target.value)}\n          placeholder="Account UUID"\n        \/>
        <input\n          className="rounded border bg-background px-2 py-1 text-sm"\n          value={symbol}\n          onChange={(e) => setSymbol(e.target.value)}\n          placeholder="EURUSD"\n        \/>
        <input\n          className="rounded border bg-background px-2 py-1 text-sm"\n          value={volume}\n          onChange={(e) => setVolume(e.target.value)}\n          inputMode="decimal"\n          placeholder="Volume"\n        \/>
        <input\n          className="rounded border bg-background px-2 py-1 text-sm"\n          value={price}\n          onChange={(e) => setPrice(e.target.value)}\n          inputMode="decimal"\n          placeholder="Open price"\n        \/>
        <select\n          className="rounded border bg-background px-2 py-1 text-sm"\n          value={side}\n          onChange={(e) => setSide(e.target.value as typeof side)}\n        >
          <option value="ORDER_TYPE_BUY">Buy diagnostic</option>
          <option value="ORDER_TYPE_SELL">Sell diagnostic</option>
        </select>
      </div>
      <Button disabled={validation.isPending} onClick={() => validation.mutate()}>
        {validation.isPending ? "Validating…" : "Run runtime validation"}
      </Button>
      {validation.error ? (
        <p className="text-xs text-destructive">
          {validation.error instanceof Error ? validation.error.message : "Validation failed"}
        </p>
      ) : null}
      {validation.data ? (
        <pre className="max-h-96 overflow-auto rounded border bg-muted/30 p-3 text-[11px]">
          {JSON.stringify(validation.data, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
