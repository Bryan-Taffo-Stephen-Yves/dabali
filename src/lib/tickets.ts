"use client";
import { edge, supabase, myId, isOffline } from "@/lib/supabase/client";
import { warmOffline } from "@/lib/offline";
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
  const uid = await myId();
  // Hors ligne ou erreur : on garde les tickets enregistrés sur le téléphone (jamais une liste vide par erreur)
  if (!uid || isOffline()) return sortTickets(cachedTickets());
  const { data, error } = await sb.from("tickets").select(TICKET_COLUMNS).eq("user_id", uid)
    .order("valid_from", { ascending: false }).limit(limit);
  if (error || !data) return sortTickets(cachedTickets());
  const list = data as unknown as Ticket[];
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
  // Pages des tickets valides gardées par le service worker (avec leurs fichiers) pour le mode avion
  if (r.ok) warmOffline(r.tokens.map((t) => `/app/tickets/${t.ticket_id}`));
  return cache;
}

// ───────── Commandes à heure de retrait ─────────
export const isOrder = (t: Pick<Ticket, "pickup_at">) => !!t.pickup_at;
export const orderDish = (t: Ticket) => t.order_item?.dish ?? t.dish;
export const PREP_STEPS = ["Reçue", "En préparation", "Prête", "Récupérée"] as const;
/** Étape de la commande (0 → 3) */
export function orderStep(t: Pick<Ticket, "status" | "prep_status">): number {
  if (t.status === "used") return 3;
  return t.prep_status === "ready" ? 2 : t.prep_status === "preparing" ? 1 : 0;
}
