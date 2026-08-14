/*
 * P-Trades Hub push messaging worker.
 *
 * This worker exists ONLY to receive web-push messages and open the terminal.
 * It deliberately caches nothing and intercepts no fetches, so it can never
 * serve a stale app shell or break a preview build.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "P-Trades Hub", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "P-Trades Hub";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.tag || "ptrades-signal",
    renotify: true,
    // Trade setups expire; make the alert persist until the user acts on it.
    requireInteraction: false,
    data: { url: payload.url || "/feed" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/feed";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
