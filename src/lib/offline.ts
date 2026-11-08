"use client";
/** Pages de l'appli client gardées sur le téléphone (avec leurs fichiers JS/CSS) pour fonctionner sans réseau. */
export const OFFLINE_PAGES = [
  "/app", "/app/menu", "/app/tickets", "/app/historique", "/app/profil", "/app/notifications",
  "/app/acheter", "/app/recharger", "/app/transferer",
];

/** Demande au service worker d'enregistrer ces pages et tout ce qu'elles chargent (sans effet hors ligne). */
export function warmOffline(urls: string[] = OFFLINE_PAGES) {
  if (typeof navigator === "undefined" || !navigator.onLine || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready.then((r) => r.active?.postMessage({ type: "warm", urls })).catch(() => {});
}

/** Petit cache local pour les listes (historique, notifications) affichées hors ligne */
export function readCache<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}
export function writeCache(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
}
