/**
 * What the automatic-order engine decided, most recent first (owner only).
 *
 * This is the operational answer to "is automatic execution actually working?".
 * It reports recorded decisions only — never an inference. Rows are
 * pseudonymous by construction: the server returns no user identity, because the
 * question here is what the engine decided, not who it belonged to.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getAdminEnqueueDecisions } from "@/lib/admin.functions";
import { describeEnqueueDecision } from "@/lib/delivery/enqueue-log";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelShell, timeAgo } from "@/components/admin/AdminPanels";

export function EnqueueDecisionPanel() {
  const load = useServerFn(getAdminEnqueueDecisions);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-enqueue-decisions"],
    queryFn: () => load(),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  if (isLoading) return <Skeleton className="h-32" />;

  const rows = data ?? [];
  const queued = rows.filter((r) => r.enqueued > 0).length;

  return (
    <PanelShell
      title="Automatic-order decisions"
      right={
        <span className="text-[11px] text-muted-foreground">
          {rows.length === 0 ? "no decisions recorded" : `${queued}/${rows.length} queued an order`}
        </span>
      }
    >
      {isError ? (
        <p className="text-[11px] text-warning">
          The decision log could not be read, so no claim is made here about engine behaviour.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No decision recorded yet. The engine has published nothing since this log started — this
          is not evidence that orders were refused.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row, i) => (
            <li
              key={`${row.at}-${i}`}
              className="flex flex-wrap items-baseline gap-x-2 text-[11px]"
            >
              <span className="w-16 shrink-0 text-muted-foreground">{timeAgo(row.at)}</span>
              <span className="font-mono text-foreground">{row.instrument ?? "system"}</span>
              {row.grade ? <span className="text-muted-foreground">{row.grade}</span> : null}
              <span className={row.enqueued > 0 ? "text-success" : "text-muted-foreground"}>
                {row.enqueued > 0 ? "queued" : "no order"}
              </span>
              <span className="text-muted-foreground">{describeEnqueueDecision(row.decision)}</span>
              {row.detail && row.enqueued === 0 ? (
                <span className="text-muted-foreground">({row.detail})</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
