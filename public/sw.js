// Service worker — Telos Tech Hub
// ────────────────────────────────────────────────────────────────────────────
// Unico scopo: ricevere un push reale (spedito dall'Edge Function
// "invia-push") e mostrarlo come notifica di sistema, anche a scheda in
// background o browser non in primo piano — questo è il pezzo che rende
// possibile una notifica "come un'app" oltre al semplice badge in pagina.
// Nessuna cache offline: non è uno scopo di questo service worker.
// ────────────────────────────────────────────────────────────────────────────

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Telos Tech Hub", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Telos Tech Hub";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
    tag: data.tag || undefined,
  };
  // Pallino/numero sull'icona (Badge API — iOS 16.4+, Android/desktop dove
  // supportata). "badge" nel payload è il conteggio di non lette calcolato
  // lato server al momento dell'invio (vedi invia-push): più preciso che
  // limitarsi a +1 per ogni push, specie se più notifiche arrivano vicine.
  const impostaBadge = ("setAppBadge" in self.navigator && typeof data.badge === "number")
    ? self.navigator.setAppBadge(data.badge).catch(()=>{})
    : Promise.resolve();
  event.waitUntil(Promise.all([impostaBadge, self.registration.showNotification(title, options)]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if("clearAppBadge" in self.navigator) self.navigator.clearAppBadge().catch(()=>{});
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
