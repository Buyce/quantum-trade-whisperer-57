/**
 * Learning Evidence — slices, gate-change proposals and post-change checks.
 *
 * Stage 1 of "learning from rejected setups": the system PROPOSES, the owner
 * DECIDES. Approving a proposal is the only way a live gate threshold can
 * change, and every approval is audited. All outcome numbers are replay-derived
 * research outcomes from real candles — never broker fills or money P/L.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  decideGateChange,
  getLearningEvidence,
  proposeGateChange,
} from "@/lib/learning.functions";
import {
  ci95,
  PROPOSAL_STATUS_LABELS,
  sliceDecidable,
  slicesByDim,
  TUNABLE_GATE_LABELS,
  type GateChangeProposal,
  type LearningStatRow,
  type SliceDim,
} from "@/lib/learning/evidence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { utcMinute } from "@/lib/format-utc";

function fmtR(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(2)}R`;
}

function fmtInterval(row: Pick<LearningStatRow, "mean_r" | "se_r">): string {
  const ci = ci95(row);
  return ci ? `95% CI ${ci[0].toFixed(2)} … ${ci[1].toFixed(2)}` : "no interval";
}

function SliceTable({ dim, rows }: { dim: SliceDim; rows: LearningStatRow[] }) {
  if (rows.length === 0) return null;
  // Pair pass/fail arms per gate+slice.
  const keys = [...new Set(rows.map((r) => `${r.gate}|${r.slice_key}`))];
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium capitalize">By {dim}</h4>
      <div className="space-y-2">
        {keys.map((key) => {
          const [gate, sliceKey] = key.split("|");
          const pass = rows.find((r) => r.gate === gate && r.slice_key === sliceKey && r.arm === "pass");
          const fail = rows.find((r) => r.gate === gate && r.slice_key === sliceKey && r.arm === "fail");
          const decidable = sliceDecidable(pass, fail);
          return (
            <div key={key} className="rounded-lg border border-border p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  {gate} · {sliceKey || "unknown"}
                </span>
                <Badge variant={decidable ? "default" : "outline"}>
                  {decidable ? "decidable" : "not yet decidable"}
                </Badge>
              </div>
              <div className="mt-1 grid gap-1 text-muted-foreground sm:grid-cols-2">
                <span>
                  published {fmtR(pass?.mean_r)} · n={pass?.n_used ?? 0} ·{" "}
                  {pass ? fmtInterval(pass) : "no data"}
                </span>
                <span>
                  rejected {fmtR(fail?.mean_r)} · n={fail?.n_used ?? 0} ·{" "}
                  {fail ? fmtInterval(fail) : "no data"}
                </span>
              </div>
              {!decidable && (
                <p className="mt-1 text-muted-foreground">
                  {pass?.reason ?? fail?.reason ?? "waiting for matured replay outcomes"}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProposalRow({
  proposal,
  onDecide,
  busy,
}: {
  proposal: GateChangeProposal;
  onDecide: (id: string, decision: "approved" | "rejected" | "reverted") => void;
  busy: boolean;
}) {
  const snap = proposal.stats_snapshot;
  return (
    <div className="rounded-lg border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground">
          {TUNABLE_GATE_LABELS[proposal.gate] ?? proposal.gate}:{" "}
          {proposal.current_value ?? "default"} → {proposal.proposed_value}
        </span>
        <Badge
          variant={
            proposal.status === "approved"
              ? "default"
              : proposal.status === "proposed"
                ? "secondary"
                : "outline"
          }
        >
          {PROPOSAL_STATUS_LABELS[proposal.status]}
        </Badge>
      </div>
      <p className="mt-1 text-muted-foreground">
        Evidence frozen {utcMinute(snap.as_of)} UTC · published{" "}
        {fmtR(snap.pass.mean_r)} (n={snap.pass.n_used ?? 0}) vs rejected {fmtR(snap.fail.mean_r)}{" "}
        (n={snap.fail.n_used ?? 0}) · verdict:{" "}
        {proposal.verdict === "loosening_supported" ? "loosening supported" : "gate supported"}
      </p>
      {proposal.decision_reason && (
        <p className="mt-1 text-muted-foreground">Reason: {proposal.decision_reason}</p>
      )}
      {proposal.status === "proposed" && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => onDecide(proposal.id, "approved")}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide(proposal.id, "rejected")}
          >
            Reject
          </Button>
        </div>
      )}
      {proposal.status === "approved" && (
        <div className="mt-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => onDecide(proposal.id, "reverted")}
          >
            Revert to previous value
          </Button>
        </div>
      )}
    </div>
  );
}

export function LearningEvidencePanel() {
  const queryClient = useQueryClient();
  const fetchEvidence = useServerFn(getLearningEvidence);
  const runPropose = useServerFn(proposeGateChange);
  const runDecide = useServerFn(decideGateChange);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "learning-evidence"],
    queryFn: () => fetchEvidence(),
    staleTime: 60_000,
  });

  const [gate, setGate] = useState<"risk_ceiling" | "headroom" | "reachable_r">("risk_ceiling");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "learning-evidence"] });

  const proposeMutation = useMutation({
    mutationFn: () =>
      runPropose({ data: { gate, proposedValue: Number(value), reason } }),
    onSuccess: () => {
      toast.success("Proposal recorded — awaiting your decision");
      setValue("");
      setReason("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Proposal refused"),
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "rejected" | "reverted" }) => {
      const why = window.prompt(`Reason for ${decision} (recorded in the audit log):`);
      if (!why || why.trim().length < 3) throw new Error("A reason is required");
      return runDecide({ data: { id, decision, reason: why.trim() } });
    },
    onSuccess: () => {
      toast.success("Decision recorded and audited");
      invalidate();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Decision failed"),
  });

  const slices = data ? slicesByDim(data.rows) : null;
  const busy = proposeMutation.isPending || decideMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Learning Evidence — proposals &amp; verification</CardTitle>
        <p className="text-sm text-muted-foreground">
          Replay-derived research outcomes only. The system proposes; you decide. Approving is the
          single audited path that can change a live gate threshold.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive">
            Could not load learning evidence:{" "}
            {error instanceof Error ? error.message : "unknown error"}
          </p>
        ) : !data ? null : (
          <>
            <div>
              <h4 className="mb-2 text-sm font-medium">Active threshold overrides</h4>
              {data.overrides.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  None — all gates run their compiled-in defaults.
                </p>
              ) : (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {data.overrides.map((o) => (
                    <div key={o.gate}>
                      <span className="text-foreground">{TUNABLE_GATE_LABELS[o.gate] ?? o.gate}</span>
                      {" = "}
                      {o.value} · set by {o.set_by} ·{" "}
                      {utcMinute(o.updated_at)} UTC
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-sm font-medium">Propose a gate change</h4>
              <p className="mb-2 text-xs text-muted-foreground">
                The database refuses unless both arms are decidable (30+ matured samples each,
                non-overlapping 95% intervals).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                  value={gate}
                  onChange={(e) => setGate(e.target.value as typeof gate)}
                >
                  {Object.entries(TUNABLE_GATE_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
                <Input
                  className="w-28"
                  placeholder="new value"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
                <Input
                  className="min-w-48 flex-1"
                  placeholder="reason (recorded in the audit log)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={busy || !Number(value) || reason.trim().length < 3}
                  onClick={() => proposeMutation.mutate()}
                >
                  Propose
                </Button>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-medium">Proposals</h4>
              {data.proposals.length === 0 ? (
                <p className="text-xs text-muted-foreground">No proposals yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.proposals.map((p) => (
                    <ProposalRow
                      key={p.id}
                      proposal={p}
                      busy={busy}
                      onDecide={(id, decision) => decideMutation.mutate({ id, decision })}
                    />
                  ))}
                </div>
              )}
            </div>

            {slices && (
              <div className="space-y-4">
                <h4 className="text-sm font-medium">Evidence slices</h4>
                {(["instrument", "direction", "session"] as SliceDim[]).map((dim) => (
                  <SliceTable key={dim} dim={dim} rows={slices[dim]} />
                ))}
                {slices.instrument.length === 0 &&
                  slices.direction.length === 0 &&
                  slices.session.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Slice rows appear after the next hourly recompute.
                    </p>
                  )}
              </div>
            )}

            {data.post_change.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-medium">Post-change verification</h4>
                <p className="mb-2 text-xs text-muted-foreground">
                  Cohorts detected after each applied change, kept separate from the pre-change
                  population. The change is considered verified only if the published arm still
                  outperforms the rejected arm.
                </p>
                <div className="space-y-2">
                  {data.post_change.map((c) => (
                    <div key={c.proposal_id} className="rounded-lg border border-border p-3 text-xs">
                      <div className="font-medium text-foreground">
                        {TUNABLE_GATE_LABELS[c.gate] ?? c.gate} · applied{" "}
                        {utcMinute(c.applied_at)} UTC
                      </div>
                      <div className="mt-1 grid gap-1 text-muted-foreground sm:grid-cols-2">
                        {c.arms.map((a) => (
                          <span key={a.arm}>
                            {a.arm === "pass" ? "published" : "rejected"} {fmtR(a.mean_r)} · n=
                            {a.n_used} · {a.cluster_n} clusters
                          </span>
                        ))}
                        {c.arms.length === 0 && <span>No post-change cohort rows yet.</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
