/**
 * Browser-side web-push registration.
 *
 * Registers the push-only worker (`/push-sw.js` — it caches nothing), asks for
 * the notification permission, and stores the resulting subscription against
 * the signed-in user. iOS only exposes the Push API to apps that have been
 * added to the Home Screen, so `supported` reports that honestly instead of
 * failing silently.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPushConfig, removePushSubscription, savePushSubscription } from "@/lib/push.functions";

export type PushStatus = "unsupported" | "needs-install" | "denied" | "off" | "on";

function toBase64Url(buffer: ArrayBuffer | null) {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone;
  return window.matchMedia("(display-mode: standalone)").matches || iosStandalone === true;
}

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function usePush() {
  const [status, setStatus] = useState<PushStatus>("off");
  const [busy, setBusy] = useState(false);
  const save = useServerFn(savePushSubscription);
  const remove = useServerFn(removePushSubscription);
  const config = useServerFn(getPushConfig);

  const read = useCallback(async () => {
    if (typeof window === "undefined") return;
    const hasApis =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!hasApis) {
      setStatus(isIos() && !isStandalone() ? "needs-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration("/push-sw.js");
    const subscription = await registration?.pushManager.getSubscription();
    setStatus(subscription ? "on" : "off");
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const { publicKey } = await config();
      if (!publicKey) throw new Error("Push is not configured on the server yet");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return { ok: false, reason: "permission" as const };
      }

      const registration = await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;

      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      await save({
        data: {
          endpoint: subscription.endpoint,
          p256dh: toBase64Url(subscription.getKey("p256dh")),
          auth: toBase64Url(subscription.getKey("auth")),
          userAgent: navigator.userAgent.slice(0, 300),
        },
      });
      setStatus("on");
      return { ok: true as const };
    } finally {
      setBusy(false);
    }
  }, [config, save]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/push-sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await remove({ data: { endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
      }
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }, [remove]);

  return { status, busy, enable, disable, refresh: read, standalone: isStandalone(), ios: isIos() };
}
