// Dabali — service worker
// Objectif (§4.11) : les QR des tickets valides restent affichables en mode avion.
// - pages de l'appli : réseau d'abord, repli sur la dernière version en cache
// - fichiers statiques Next (/_next/static) : cache d'abord (noms versionnés)
// - API Supabase : jamais mise en cache ici (les jetons QR sont gardés par l'appli dans localStorage)
const VERSION = "dabali-v5";
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

  // Photos des plats : affichées tout de suite depuis le téléphone, mises à jour en arrière-plan
  if (url.pathname.startsWith("/dishes/")) {
    e.respondWith(
      caches.open(VERSION).then((c) => c.match(req).then((hit) => {
        const update = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || update;
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
          // Page jamais ouverte : on redirige vers une page gardée (pas une autre page affichée sous la mauvaise adresse)
          const to = url.pathname.startsWith("/app/tickets/") && (await caches.match("/app/tickets")) ? "/app/tickets" : "/app";
          if (url.pathname !== to && (await caches.match(to))) return Response.redirect(to, 302);
          return Response.error();
        }),
    );
  }
});

// L'appli demande (en ligne) de garder ses pages et TOUS les fichiers qu'elles chargent :
// sans cela, une page gardée sans ses fichiers JS s'affiche mais aucun bouton ne répond hors ligne.
self.addEventListener("message", (e) => {
  if (!e.data || e.data.type !== "warm" || !Array.isArray(e.data.urls)) return;
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    const assets = new Set();
    for (const u of e.data.urls.slice(0, 30)) {
      try {
        const res = await fetch(u, { credentials: "include" });
        if (!res.ok || res.redirected || !(res.headers.get("content-type") || "").includes("text/html")) continue;
        const html = await res.clone().text();
        await cache.put(u, res);
        for (const m of html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)) assets.add(m[0]);
      } catch {}
    }
    await Promise.all([...assets].map(async (a) => {
      if (await cache.match(a)) return;
      try { const r = await fetch(a); if (r.ok) await cache.put(a, r); } catch {}
    }));
  })());
});

// Notifications push : affichées même quand l'appli est fermée
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Dabali", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Dabali", {
    body: d.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: d.tag,
    renotify: !!d.tag,
    vibrate: [80, 40, 80],
    data: { href: d.href || "/app/notifications" },
  }));
});

// Toucher la notification ouvre la bonne page (réutilise l'onglet de l'appli s'il existe)
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const href = (e.notification.data && e.notification.data.href) || "/app";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) { await c.focus(); return c.navigate(href); }
    }
    return self.clients.openWindow(href);
  })());
});
