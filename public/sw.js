// Dabali — service worker
// Objectif (§4.11) : les QR des tickets valides restent affichables en mode avion.
// - pages de l'appli : réseau d'abord, repli sur la dernière version en cache
// - fichiers statiques Next (/_next/static) : cache d'abord (noms versionnés)
// - API Supabase : jamais mise en cache ici (les jetons QR sont gardés par l'appli dans localStorage)
const VERSION = "dabali-v1";
const PAGES = ["/app", "/app/tickets", "/app/menu", "/app/profil"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PAGES).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.endsWith(".woff2")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      })),
    );
    return;
  }

  // Requêtes RSC (navigation interne Next) : réseau uniquement. En cas d'échec, Next bascule
  // sur une navigation classique, servie par le cache HTML ci-dessous.
  if (req.headers.get("RSC") || url.searchParams.has("_rsc")) return;

  // Pages HTML de l'appli client : réseau d'abord, cache en secours
  if (url.pathname.startsWith("/app") || req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req, { ignoreSearch: true });
          if (hit) return hit;
          if (url.pathname.startsWith("/app/tickets/")) {
            const list = await caches.match("/app/tickets");
            if (list) return list;
          }
          return (await caches.match("/app")) || Response.error();
        }),
    );
  }
});
