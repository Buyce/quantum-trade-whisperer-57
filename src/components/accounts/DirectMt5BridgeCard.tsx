import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Cable, Copy, Loader2, ShieldCheck, Unplug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  createMt5BridgePairing,
  listMt5BridgeConnections,
  revokeMt5BridgePairing,
} from "@/lib/mt5-bridge/pairing.functions";

type PairingSecret = {
  bridgeId: string;
  token: string;
  ingestPath: string;
  intent: "demo" | "live";
};

const recent = (iso: string | null) => (iso ? Date.now() - Date.parse(iso) <= 30_000 : false);

export function DirectMt5BridgeCard() {
  const client = useQueryClient();
  const create = useServerFn(createMt5BridgePairing);
  const revoke = useServerFn(revokeMt5BridgePairing);
  const [secret, setSecret] = useState<PairingSecret | null>(null);

  const bridges = useQuery({
    queryKey: ["direct-mt5-bridges"],
    queryFn: () => listMt5BridgeConnections(),
    refetchInterval: 10_000,
  });

  const createMutation = useMutation({
    mutationFn: (intent: "demo" | "live") => create({ data: { intent } }),
    onSuccess: (result) => {
      setSecret(result);
      void client.invalidateQueries({ queryKey: ["direct-mt5-bridges"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revoke({ data: { id } }),
    onSuccess: () => {
      setSecret(null);
      void client.invalidateQueries({ queryKey: ["direct-mt5-bridges"] });
      toast.success("Direct MT5 bridge revoked.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied.`);
  };

  const ingestUrl =
    secret && typeof window !== "undefined"
      ? `${window.location.origin}${secret.ingestPath}`
      : (secret?.ingestPath ?? "");

  return (
    <section className="mb-5 rounded-sm border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <Cable className="mt-0.5 size-5" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Direct MT5 Bridge</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect a Windows/VPS MetaTrader 5 terminal directly to P-Trades. Pairing is read-only:
            it can report broker/account state but cannot place, modify or close trades.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate("demo")}
        >
          {createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Pair demo MT5
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate("live")}
        >
          Pair live MT5 (observe only)
        </Button>
      </div>

      {secret ? (
        <div className="mt-4 rounded-sm border border-warning/40 bg-warning/5 p-3 text-xs">
          <p className="font-medium text-foreground">One-time bridge credentials</p>
          <p className="mt-1 text-muted-foreground">
            Copy these now. P-Trades stores only the token hash and cannot show the token again.
          </p>
          {[
            ["Bridge ID", secret.bridgeId],
            ["Bridge token", secret.token],
            ["Ingest URL", ingestUrl],
          ].map(([label, value]) => (
            <div key={label} className="mt-2 flex items-center gap-2">
              <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
              <code className="min-w-0 flex-1 overflow-x-auto rounded bg-background px-2 py-1">
                {value}
              </code>
              <Button size="icon" variant="ghost" onClick={() => void copy(value, label)}>
                <Copy className="size-3.5" />
              </Button>
            </div>
          ))}
          <p className="mt-3 text-muted-foreground">
            On the Windows/VPS machine running MT5, install the bridge requirements, set
            P_TRADES_BRIDGE_ID, P_TRADES_BRIDGE_TOKEN and P_TRADES_BRIDGE_INGEST_URL to these
            values, then run bridge/mt5/agent.py. Keep MT5 logged into the same {secret.intent}{" "}
            account you selected here.
          </p>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {(bridges.data ?? []).map((bridge) => {
          const online = bridge.status === "healthy" && recent(bridge.lastSeenAt);
          return (
            <div
              key={bridge.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border p-3 text-xs"
            >
              <div>
                <p className="flex items-center gap-2 font-medium text-foreground">
                  {online ? (
                    <ShieldCheck className="size-4 text-success" />
                  ) : (
                    <Cable className="size-4" />
                  )}
                  {bridge.brokerName ?? "Direct MT5"} · {bridge.intent.toUpperCase()}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {online
                    ? "Connected — broker snapshots are arriving."
                    : bridge.status === "awaiting_first_snapshot"
                      ? "Waiting for the first MT5 snapshot."
                      : (bridge.statusReason ?? "Bridge is not currently online.")}
                  {bridge.brokerLoginMasked ? ` · ${bridge.brokerLoginMasked}` : ""}
                  {bridge.brokerServer ? ` · ${bridge.brokerServer}` : ""}
                </p>
                {bridge.lastSeenAt ? (
                  <p className="mt-1 text-muted-foreground">
                    Last seen {new Date(bridge.lastSeenAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
              {bridge.status !== "revoked" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={revokeMutation.isPending}
                  onClick={() => revokeMutation.mutate(bridge.id)}
                >
                  <Unplug className="size-3.5" /> Revoke
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
