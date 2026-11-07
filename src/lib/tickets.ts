"use client";
import { edge, supabase } from "@/lib/supabase/client";
import { TICKET_COLUMNS, type Ticket, type TicketStatus } from "@/lib/types";

/** Statut affiché : un ticket « valide » dont le service est fini passe au rouge sans attendre le cron. */
export function displayStatus(t: Pick<Ticket, "status" | "valid_until">, now = Date.now()): TicketStatus {
  if (t.status === "valid" && new Date(t.valid_until).getTime() <= now) return "expired";
  return t.status;
}

export const STATUS_META: Record<TicketStatus, { label: string; dot: string; chip: string }> = {
  valid: { label: "Valide", dot: "bg-ok", chip: "bg-ok-soft text-[#15803d]" },
  expired: { label: "Expiré", dot: "bg-err", chip: "bg-err-soft text-err" },
  used: { label: "Utilisé", dot: "bg-off", chip: "bg-canvas text-muted" },
  cancelled: { label: "Annulé", dot: "bg-ink", chip: "bg-ink text-white" },
};

const ORDER: Record<TicketStatus, number> = { valid: 0, expired: 1, used: 2, cancelled: 3 };

export async function fetchMyTickets(limit = 60): Promise<Ticket[]> {
  const sb = supabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return [];
  const { data } = await sb.from("tickets").select(TICKET_COLUMNS).eq("user_id", user.id)
    .order("valid_from", { ascending: false }).limit(limit);
  const list = (data ?? []) as unknown as Ticket[];
  cacheTickets(list);
  return sortTickets(list);
}

export function sortTickets(list: Ticket[]) {
  return [...list].sort((a, b) => {
    const sa = ORDER[displayStatus(a)], sb = ORDER[displayStatus(b)];
    if (sa !== sb) return sa - sb;
    // valides : le plus proche d'abord ; autres : le plus récent d'abord
    return sa === 0 ? a.valid_from.localeCompare(b.valid_from) : b.valid_from.localeCompare(a.valid_from);
  });
}

// ───────── Cache hors ligne : tickets valides + jetons QR signés (§4.11) ─────────
const T_KEY = "dabali:tickets";
const Q_KEY = "dabali:qr";

function read<T>(k: string, d: T): T {
  try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; }
}
function write(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
}

export function cacheTickets(list: Ticket[]) {
  write(T_KEY, list.filter((t) => displayStatus(t) === "valid"));
}
export function cachedTickets(): Ticket[] {
  return read<Ticket[]>(T_KEY, []).filter((t) => displayStatus(t) === "valid");
}
export function cachedTicket(id: string): Ticket | undefined {
  return read<Ticket[]>(T_KEY, []).find((t) => t.id === id);
}

type QrCache = Record<string, { token: string; valid_until: string }>;

export function cachedToken(id: string): string | null {
  const c = read<QrCache>(Q_KEY, {})[id];
  return c && new Date(c.valid_until).getTime() > Date.now() ? c.token : null;
}

/** Récupère (et met en cache) les jetons QR signés de mes tickets valides. */
export async function syncTokens(): Promise<QrCache> {
  const r = await edge<{ tokens: { ticket_id: string; token: string; valid_until: string }[] }>("ticket-token", {});
  const cache: QrCache = {};
  const now = Date.now();
  for (const [id, v] of Object.entries(read<QrCache>(Q_KEY, {}))) {
    if (new Date(v.valid_until).getTime() > now) cache[id] = v;
  }
  if (r.ok) for (const t of r.tokens) cache[t.ticket_id] = { token: t.token, valid_until: t.valid_until };
  write(Q_KEY, cache);
  // Préchargement des pages de tickets : le service worker les garde pour le mode avion
  if (r.ok && "serviceWorker" in navigator && navigator.serviceWorker.controller) {
    for (const t of r.tokens) fetch(`/app/tickets/${t.ticket_id}`, { credentials: "include" }).catch(() => {});
  }
  return cache;
}
