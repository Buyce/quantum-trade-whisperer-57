/**
 * Automatic stage ladder (owner only).
 *
 * Shows what the daily lifecycle job would decide right now for every registry
 * instrument, and why. This panel is a READ: it applies nothing, and the daily job
 * applies changes only through the audited transition record.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { PanelShell } from "@/components/admin/AdminPanels";
import { Skeleton } from "@/components/ui/skeleton";
import { getAdminStageLadder } from "@/lib/admin.functions";

const STAGE_LABEL: Record<string, string> = {
  disabled: "Off",
  data_validation: "Checking data",
  shadow: "Measuring quietly",
  signals_only: "Sending signals",
  execution_approved: "Allowed to trade",
  suspended: "Suspended",
};

const r = (v: number | null) => (typeof v === "number" ? `${v.toFixed(3)}R` : "—");

export function StageLadderPanel() {
  const load = useServerFn(getAdminStageLadder);
  const query = useQuery({
    queryKey: ["admin-stage-ladder"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (query.isLoading) return <Skeleton className="h-40" />;

  if (query.isError || !query.data) {
    return (
      <PanelShell title="Automatic stage ladder">
        <p className="text-[11px] text-warning">
          The lifecycle evidence could not be read, so nothing is claimed here. When this evidence
          is unreadable the daily job also moves nothing.
        </p>
      </PanelShell>
    );
  }

  const { verdicts, windowDays, enabled, warnings } = query.data;

  return (
    <PanelShell title="Automatic stage ladder">
      <p className="text-[11px] text-muted-foreground">
        Instruments climb one step a day at most — checking data, measuring quietly, sending
        signals, allowed to trade — and only when the recorded evidence of the last {windowDays}{" "}
        days clears every gate for the next step. Evidence that goes backwards moves an instrument
        down again. Reaching &ldquo;allowed to trade&rdquo; only removes the lifecycle block: your
        execution switch, each account&apos;s settings, the risk brakes and the intelligence gate
        all still apply.
      </p>
      <p className="mt-1 text-[11px]">
        Automatic movement is currently{" "}
        <span className={enabled ? "text-success" : "text-warning"}>{enabled ? "on" : "off"}</span>.
      </p>

      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-warning">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[11px]">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-3">Instrument</th>
              <th className="py-1 pr-3">Now</th>
              <th className="py-1 pr-3">Next decision</th>
              <th className="py-1 pr-3">Measured</th>
              <th className="py-1">Why</th>
            </tr>
          </thead>
          <tbody>
            {verdicts.map((v) => (
              <tr key={v.instrument} className="border-t border-border/40 align-top">
                <td className="py-1.5 pr-3 font-medium">{v.instrument}</td>
                <td className="py-1.5 pr-3">{STAGE_LABEL[v.stage ?? ""] ?? "Unknown"}</td>
                <td className="py-1.5 pr-3">
                  {v.action === "promote" && (
                    <span className="text-success">
                      Move up to {STAGE_LABEL[v.target ?? ""] ?? v.target}
                    </span>
                  )}
                  {v.action === "demote" && (
                    <span className="text-warning">
                      Move back to {STAGE_LABEL[v.target ?? ""] ?? v.target}
                    </span>
                  )}
                  {v.action === "hold" && <span className="text-muted-foreground">Stay</span>}
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {v.shadowSamples ?? 0} outcomes · {r(v.shadowExpectedR)} (low {r(v.shadowCiLow)})
                  {v.missingnessPct === null
                    ? " · gaps unmeasured"
                    : ` · gaps ${v.missingnessPct.toFixed(1)}%`}
                </td>
                <td className="py-1.5">
                  {v.reasons.length === 0 ? (
                    <span className="text-muted-foreground">Every gate met.</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {v.reasons.slice(0, 3).map((reason, i) => (
                        <li key={i}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  );
}
