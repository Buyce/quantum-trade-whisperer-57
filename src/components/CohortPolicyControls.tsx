/**
 * Per-pair, per-direction automatic-trading rules.
 *
 * The owner decides, for each pair AND side, whether automatic orders are
 * allowed at their normal risk, placed with a smaller share of it, or not placed
 * at all. Reduce-only, like every other automatic-order rule: nothing here can
 * create an order, enlarge one, or change what the feed shows, what is published,
 * how a setup is graded, or any measurement.
 *
 * The evidence column is a record of what has already been measured over whole
 * published plans — never a forecast.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  getCohortPolicies,
  getIntelGateCohorts,
  saveCohortPolicy,
} from "@/lib/execution.functions";
import { INSTRUMENT_LABELS } from "@/lib/db-types";
import {
  COHORT_RISK_SHARES,
  isCohortPolicyKind,
  type CohortPolicyKind,
} from "@/lib/delivery/cohort-policy";
import { Label } from "@/components/ui/label";

const DIRECTIONS: Array<"long" | "short"> = ["long", "short"];

function expectedR(v: number | null): string {
  return v === null ? "not measured" : `${v >= 0 ? "+" : ""}${v.toFixed(3)}R`;
}

export function CohortPolicyControls({ instruments }: { instruments: string[] }) {
  const loadPolicies = useServerFn(getCohortPolicies);
  const loadEvidence = useServerFn(getIntelGateCohorts);
  const save = useServerFn(saveCohortPolicy);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const policies = useQuery({
    queryKey: ["cohort-policies"],
    queryFn: () => loadPolicies(),
    staleTime: 30_000,
  });
  const evidence = useQuery({
    queryKey: ["intel-gate-cohorts"],
    queryFn: () => loadEvidence(),
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (input: {
      instrument: string;
      direction: "long" | "short";
      policy: CohortPolicyKind;
      riskSharePercent?: number;
    }) => save({ data: input }),
    onSuccess: async (result, input) => {
      setPending(null);
      if (!result?.ok) {
        toast.error(result?.error ?? "That rule could not be saved, so nothing changed.");
        return;
      }
      const label = `${input.instrument} ${input.direction}`;
      if (input.policy === "block") {
        toast.success(`Automatic orders are now off for ${label}.`);
      } else if (input.policy === "reduce") {
        toast.success(`${label} will use ${result.riskSharePercent}% of your normal risk.`);
      } else {
        toast.warning(
          `${label} is back to your normal risk. This removes a restriction you had set — every other rule still applies.`,
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["cohort-policies"] });
    },
    onError: () => {
      setPending(null);
      toast.error("That rule could not be saved, so nothing changed.");
    },
  });

  const rows = policies.data?.policies ?? [];
  const find = (instrument: string, direction: string) =>
    rows.find(
      (r) =>
        r.instrument?.toUpperCase() === instrument.toUpperCase() &&
        r.direction?.toLowerCase() === direction,
    );
  const measured = evidence.data?.cohorts ?? [];
  const findEvidence = (instrument: string, direction: string) =>
    measured.find((c) => c.instrument === instrument && c.direction === direction) ?? null;

  return (
    <section className="space-y-4 rounded-md border border-border bg-card p-4">
      <div>
        <h2 className="label-xs">Automatic trading per pair and direction</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose, side by side, which pairs your automatic orders may trade. This affects automatic
          orders only: your feed, your alerts and everything the scanner publishes and measures are
          unchanged. A rule can only ever refuse an order or place it with a smaller share of your
          normal risk — it can never place one or make one bigger.
        </p>
      </div>

      {policies.isError ? (
        <p className="text-xs text-warning">
          Your rules could not be read, so nothing is claimed here about them.
        </p>
      ) : null}

      {instruments.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No pair is selected on this account, so there is nothing to set here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2 font-normal">Pair / direction</th>
                <th className="py-1 pr-2 font-normal">Measured so far</th>
                <th className="py-1 pr-2 font-normal">Automatic orders</th>
                <th className="py-1 font-normal">Share of your risk</th>
              </tr>
            </thead>
            <tbody>
              {instruments.flatMap((instrument) =>
                DIRECTIONS.map((direction) => {
                  const key = `${instrument}:${direction}`;
                  const row = find(instrument, direction);
                  const policy: CohortPolicyKind = isCohortPolicyKind(row?.policy)
                    ? row.policy
                    : "allow";
                  // Only the offered shares can be shown; a stored value outside
                  // them (e.g. the 100 a blocked row carries) falls back to the
                  // default rather than silently selecting the smallest option.
                  const stored = row?.risk_share_percent ?? null;
                  const share = COHORT_RISK_SHARES.some((s) => s === stored)
                    ? (stored as number)
                    : COHORT_RISK_SHARE_DEFAULT;
                  const ev = findEvidence(instrument, direction);
                  const busy = pending === key && mutation.isPending;
                  return (
                    <tr key={key} className="border-t border-border/40">
                      <td className="py-2 pr-2 text-foreground">
                        {INSTRUMENT_LABELS[instrument] ?? instrument}{" "}
                        <span className="text-muted-foreground">{direction}</span>
                      </td>
                      <td className="py-2 pr-2 tabular-nums text-muted-foreground">
                        {ev ? expectedR(ev.meanR) : "not measured"}
                        {ev?.samples ? (
                          <span className="text-muted-foreground"> ({ev.samples} plans)</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-2">
                        <Label className="sr-only" htmlFor={`policy-${key}`}>
                          Automatic orders for {instrument} {direction}
                        </Label>
                        <select
                          id={`policy-${key}`}
                          className="h-8 rounded-sm border border-border bg-background px-2 text-xs"
                          value={policy}
                          disabled={busy}
                          onChange={(e) => {
                            const next = e.target.value as CohortPolicyKind;
                            setPending(key);
                            mutation.mutate({
                              instrument,
                              direction,
                              policy: next,
                              ...(next === "reduce" ? { riskSharePercent: share } : {}),
                            });
                          }}
                        >
                          <option value="allow">Allowed at normal risk</option>
                          <option value="reduce">Allowed with less risk</option>
                          <option value="block">Off</option>
                        </select>
                      </td>
                      <td className="py-2">
                        {policy === "reduce" ? (
                          <>
                            <Label className="sr-only" htmlFor={`share-${key}`}>
                              Share of normal risk for {instrument} {direction}
                            </Label>
                            <select
                              id={`share-${key}`}
                              className="h-8 rounded-sm border border-border bg-background px-2 text-xs"
                              value={String(share)}
                              disabled={busy}
                              onChange={(e) => {
                                setPending(key);
                                mutation.mutate({
                                  instrument,
                                  direction,
                                  policy: "reduce",
                                  riskSharePercent: Number(e.target.value),
                                });
                              }}
                            >
                              {COHORT_RISK_SHARES.map((s) => (
                                <option key={s} value={String(s)}>
                                  {s}% of normal
                                </option>
                              ))}
                            </select>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Each change is saved on its own, straight away. What has been measured on a pair and side is
        a record of the past over whole published plans, including plans that never traded, counted
        as 0R. It is not a prediction of what the same pair will do next.
      </p>
    </section>
  );
}
