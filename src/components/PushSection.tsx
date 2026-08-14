/**
 * Push delivery controls: device registration, registered-device list and a
 * self-test. The stored `notify_push` preference decides whether the scanner
 * fans out to this user at all; the browser subscription decides whether this
 * particular device can receive it — both are surfaced separately so a user is
 * never left thinking alerts are armed when the browser permission is missing.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { BellRing, Loader2, Trash2 } from "lucide-react";

import { usePush } from "@/lib/usePush";
import { listPushDevices, removePushSubscription, sendTestPush } from "@/lib/push.functions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

function deviceLabel(userAgent: string | null) {
  if (!userAgent) return "Unknown device";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "iOS device";
  if (/android/i.test(userAgent)) return "Android device";
  if (/mac os/i.test(userAgent)) return "Mac";
  if (/windows/i.test(userAgent)) return "Windows PC";
  return "Browser";
}

export function PushSection({
  enabled,
  onEnabledChange,
}: {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
}) {
  const { status, busy, enable, disable, refresh } = usePush();
  const queryClient = useQueryClient();
  const devices = useQuery({ queryKey: ["push-devices"], queryFn: () => listPushDevices() });
  const test = useServerFn(sendTestPush);
  const remove = useServerFn(removePushSubscription);
  const [testing, setTesting] = useState(false);

  async function onToggle(value: boolean) {
    onEnabledChange(value);
    if (!value) return;
    try {
      const result = await enable();
      if (result?.ok) {
        toast.success("This device is registered for push alerts");
        await queryClient.invalidateQueries({ queryKey: ["push-devices"] });
      } else {
        toast.error("Notification permission was not granted");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not register this device");
    }
  }

  async function onTest() {
    setTesting(true);
    try {
      const { sent } = await test({ data: undefined });
      if (sent > 0) toast.success(`Test alert sent to ${sent} device${sent === 1 ? "" : "s"}`);
      else toast.error("No reachable device. Register this one first.");
      await queryClient.invalidateQueries({ queryKey: ["push-devices"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test push failed");
    } finally {
      setTesting(false);
    }
  }

  async function onRemove(endpoint: string) {
    try {
      await remove({ data: { endpoint } });
      await queryClient.invalidateQueries({ queryKey: ["push-devices"] });
      await refresh();
      toast.success("Device removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove device");
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-border bg-card p-4">
      <h2 className="label-xs">Push alerts</h2>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <Label htmlFor="notify-push" className="text-sm font-medium">
            Browser &amp; Android push
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Fires within seconds of a new signal at or above your alert minimum grade.
          </p>
        </div>
        <Switch id="notify-push" checked={enabled} onCheckedChange={(v) => void onToggle(v)} disabled={busy} />
      </div>

      {status === "denied" && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive-foreground">
          This browser has blocked notifications. Re-allow them in the site permissions, then toggle again.
        </p>
      )}
      {status === "needs-install" && (
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          On iPhone and iPad, push works only after you add P-Trades Hub to the Home Screen (Share → Add to Home
          Screen), then open it from the icon.
        </p>
      )}
      {status === "unsupported" && (
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          This browser does not support web push. Email alerts and the webhook dispatcher still work.
        </p>
      )}
      {enabled && status === "off" && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">This device is not registered yet.</p>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onToggle(true)}>
            Register this device
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          size="sm"
          variant="outline"
          className="h-10 w-full sm:h-9 sm:w-auto"
          onClick={() => void onTest()}
          disabled={testing || status !== "on"}
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
          Send test alert
        </Button>
        {status === "on" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-10 w-full sm:h-9 sm:w-auto"
            disabled={busy}
            onClick={() => void disable().then(() => queryClient.invalidateQueries({ queryKey: ["push-devices"] }))}
          >
            Unregister this device
          </Button>
        )}
      </div>

      {(devices.data?.length ?? 0) > 0 && (
        <ul className="space-y-2">
          {devices.data?.map((d) => (
            <li
              key={d.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border p-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{deviceLabel(d.user_agent)}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {d.last_success_at
                    ? `Last delivery ${new Date(d.last_success_at).toLocaleString()}`
                    : `Registered ${new Date(d.created_at).toLocaleDateString()}`}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Remove device"
                className="shrink-0"
                onClick={() => void onRemove(d.endpoint)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
