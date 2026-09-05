/**
 * Execution capability switches (owner only).
 *
 * These are the SYSTEM-WIDE gates that decide whether an account armed to an
 * automatic mode may actually submit an order. Only the demo-side switches are
 * writable here: real-money arming stays a separate, deliberate act, so this
 * panel can never turn live execution on. Every value shown is read from
 * `execution_controls`; nothing is inferred.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getAdminExecutionSwitches, setAdminExecutionSwitches } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PanelShell, timeAgo } from "@/components/admin/AdminPanels";

type SwitchField = "demoAutoEnabled" | "forceDryRun" | "liveExecutionEnabled" | "liveAutoEnabled";

type Pending = { field: SwitchField; next: boolean } | null;

function confirmCopy(pending: NonNullable<Pending>): { title: string; detail: string } {
  if (pending.field === "demoAutoEnabled") {
    return pending.next
      ? {
          title: "Enable Demo auto-execution system-wide?",
          detail:
            "Accounts their owner has armed to Demo Auto will be able to receive automatic pending orders on their broker-confirmed DEMO account. Real-money execution is unaffected and stays off.",
        }
      : {
          title: "Disable Demo auto-execution system-wide?",
          detail:
            "No new demo orders will be submitted. Accounts already armed keep their setting but cannot execute until this is enabled again.",
        };
  }
  if (pending.field === "liveExecutionEnabled") {
    return pending.next
      ? {
          title: "Enable REAL-MONEY broker execution?",
          detail:
            "Deliveries that pass every gate may be submitted to a real broker account through MetaApi (MT4/MT5), or POSTed to an allow-listed webhook bridge, and can create real orders with real money. The dry-run lock must already be off and the emergency stop clear. Per-user live confirmation, endpoint validation and pre-send revalidation still apply to every single delivery.",
        }
      : {
          title: "Disable real-money execution?",
          detail:
            "No live POST or real-account submission will be made. Dry-run validation is unaffected, and nobody's arming is changed.",
        };
  }
  if (pending.field === "liveAutoEnabled") {
    return pending.next
      ? {
          title: "Arm AUTOMATIC real-money orders?",
          detail:
            "Accounts their owner armed to Live Auto will be able to receive automatic orders on a broker-confirmed REAL account, without a human pressing anything per trade. This is the most consequential switch in the system.",
        }
      : {
          title: "Disarm automatic real-money orders?",
          detail: "No automatic orders will be submitted to real accounts.",
        };
  }
  return pending.next
    ? {
        title: "Force dry run for every delivery?",
        detail:
          "Deliveries are validated and recorded but nothing is sent to any broker. Use this to freeze execution without changing anyone's arming.",
      }
    : {
        title: "Stop forcing dry run?",
        detail:
          "Deliveries that pass every gate will be sent to the broker for real. Demo Auto only reaches DEMO accounts; live execution remains governed by its own switches.",
      };
}

export function ExecutionSwitchPanel() {
  const fetchSwitches = useServerFn(getAdminExecutionSwitches);
  const saveSwitches = useServerFn(setAdminExecutionSwitches);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Pending>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-execution-switches"],
    queryFn: () => fetchSwitches(),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const [hostDraft, setHostDraft] = useState("");

  const mutation = useMutation({
    mutationFn: (input: {
      demoAutoEnabled?: boolean;
      forceDryRun?: boolean;
      liveExecutionEnabled?: boolean;
      liveAutoEnabled?: boolean;
      allowedLiveHosts?: string[];
    }) => saveSwitches({ data: input }),
    onSuccess: () => {
      setPending(null);
      toast.success("Execution switches updated");
      void queryClient.invalidateQueries({ queryKey: ["admin-execution-switches"] });
      void queryClient.invalidateQueries({ queryKey: ["execution-status"] });
      void queryClient.invalidateQueries({ queryKey: ["connected-accounts"] });
    },
    onError: (err: Error) => {
      setPending(null);
      toast.error(err.message);
    },
  });

  if (isLoading || !data) {
    return <Skeleton className="h-32" />;
  }

  const rows: {
    key: SwitchField;
    label: string;
    detail: string;
    on: boolean;
    onLabel: string;
    offLabel: string;
  }[] = [
    {
      key: "demoAutoEnabled",
      label: "Demo auto-execution",
      detail:
        "Lets an owner arm a broker-confirmed DEMO account so eligible setups are submitted automatically.",
      on: data.demoAutoEnabled,
      onLabel: "ON",
      offLabel: "OFF",
    },
    {
      key: "forceDryRun",
      label: "Force dry run",
      detail:
        "While ON, deliveries are validated and logged but nothing reaches a broker, whatever any account is armed to.",
      on: data.forceDryRun,
      onLabel: "ON",
      offLabel: "OFF",
    },
    {
      key: "liveExecutionEnabled",
      label: "Real-money execution",
      detail:
        "Allows submissions to real broker accounts through MetaApi (MT4/MT5) and live webhook POSTs to an allow-listed bridge host. Cannot be enabled while dry run is forced or the emergency stop is on.",
      on: data.liveExecutionEnabled,
      onLabel: "ARMED",
      offLabel: "OFF",
    },
    {
      key: "liveAutoEnabled",
      label: "Automatic real-money orders",
      detail:
        "Lets an owner arm a broker-confirmed REAL account for automatic orders. Requires real-money execution to be on first.",
      on: data.liveAutoEnabled,
      onLabel: "ARMED",
      offLabel: "OFF",
    },
  ];

  return (
    <PanelShell
      title="Execution switches"
      defaultOpen
      right={
        <span className="text-[11px] text-muted-foreground">
          {data.executionPolicy} ·{" "}
          {data.updatedAt ? `changed ${timeAgo(data.updatedAt)}` : "never changed"}
        </span>
      }
    >
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-[220px] flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {row.label}
                <Badge variant={row.on ? "default" : "outline"}>
                  {row.on ? row.onLabel : row.offLabel}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{row.detail}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => setPending({ field: row.key, next: !row.on })}
            >
              Turn {row.on ? "off" : "on"}
            </Button>
          </div>
        ))}

        <div className="space-y-2 rounded-sm border border-border p-2">
          <div className="text-[11px] font-medium text-foreground">Allowed live hosts</div>
          <p className="text-[11px] text-muted-foreground">
            A live webhook POST may only go to a host listed here. An empty list means nothing can
            leave the server, whatever any other switch says. Per-request URL validation at dispatch
            is unchanged and still authoritative.
          </p>
          {data.allowedLiveHosts.length === 0 ? (
            <p className="text-[11px] text-warning">
              No host allowed — real-money webhook delivery cannot be enabled.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {data.allowedLiveHosts.map((host) => (
                <li
                  key={host}
                  className="flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-[11px]"
                >
                  <span className="font-mono">{host}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({
                        allowedLiveHosts: data.allowedLiveHosts.filter((h) => h !== host),
                        // Removing the last destination must not leave live execution armed
                        // with nowhere legitimate to send.
                        ...(data.allowedLiveHosts.length === 1
                          ? { liveExecutionEnabled: false, liveAutoEnabled: false }
                          : {}),
                      })
                    }
                    aria-label={`Remove ${host}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              value={hostDraft}
              onChange={(e) => setHostDraft(e.target.value)}
              placeholder="hooks.example.com"
              className="h-8 flex-1 rounded-sm border border-border bg-background px-2 text-[11px]"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending || hostDraft.trim() === ""}
              onClick={() => {
                mutation.mutate({
                  allowedLiveHosts: [...data.allowedLiveHosts, hostDraft.trim()],
                });
                setHostDraft("");
              }}
            >
              Add host
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          {pending ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmCopy(pending).title}</AlertDialogTitle>
                <AlertDialogDescription>{confirmCopy(pending).detail}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => mutation.mutate({ [pending.field]: pending.next })}
                >
                  Confirm
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </PanelShell>
  );
}
