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

type Pending =
  { field: "demoAutoEnabled"; next: boolean } | { field: "forceDryRun"; next: boolean } | null;

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

  const mutation = useMutation({
    mutationFn: (input: { demoAutoEnabled?: boolean; forceDryRun?: boolean }) =>
      saveSwitches({ data: input }),
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
    key: "demoAutoEnabled" | "forceDryRun";
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
  ];

  return (
    <PanelShell
      title="Execution switches"
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

        <div className="rounded-sm border border-border p-2 text-[11px] text-muted-foreground">
          Real-money switches (read-only here): live execution{" "}
          <span className="font-medium text-foreground">
            {data.liveExecutionEnabled ? "ON" : "OFF"}
          </span>
          , live auto{" "}
          <span className="font-medium text-foreground">{data.liveAutoEnabled ? "ON" : "OFF"}</span>
          .
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
