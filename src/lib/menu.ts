"use client";
import { supabase } from "@/lib/supabase/client";
import { readCache, writeCache } from "@/lib/offline";
import type { MenuItem, ServiceKind } from "@/lib/types";

export const MENU_ITEM_COLUMNS =
  "id, service_date, service, price, planned_qty, sold_qty, is_sold_out, is_full, dish:dishes(id, name, category_id, description, composition, kcal, weight_g, allergens, photo_url, photo_credit, photo_source, base_price)";

export type DishStat = { dish_id: string; avg_stars: number | null; ratings_count: number };

export async function fetchMenu(from: string, to: string): Promise<MenuItem[]> {
  // Hors ligne : dernier menu gardé sur le téléphone, limité aux jours demandés
  const offline = () => (readCache<MenuItem[]>("dabali:menu") ?? []).filter((i) => i.service_date >= from && i.service_date <= to);
  if (!navigator.onLine) return offline();
  const { data, error } = await supabase().from("menu_items").select(MENU_ITEM_COLUMNS)
    .gte("service_date", from).lte("service_date", to).order("service_date").order("price", { ascending: false });
  if (error || !data) return offline();
  writeCache("dabali:menu", data);
  return data as unknown as MenuItem[];
}

export async function fetchDishStats(): Promise<Record<string, DishStat>> {
  if (!navigator.onLine) return readCache("dabali:dish-stats") ?? {};
  const { data } = await supabase().from("dish_stats").select("dish_id, avg_stars, ratings_count");
  if (!data) return readCache("dabali:dish-stats") ?? {};
  const out = Object.fromEntries(data.map((s) => [s.dish_id, s as DishStat]));
  writeCache("dabali:dish-stats", out);
  return out;
}

export function soldOut(i: Pick<MenuItem, "is_sold_out" | "is_full">) {
  return i.is_sold_out || i.is_full;
}

export function remaining(i: Pick<MenuItem, "planned_qty" | "sold_qty">) {
  return i.planned_qty == null ? null : Math.max(0, i.planned_qty - i.sold_qty);
}

export type Tag = { label: string; tone: "dark" | "lime" | "warn" | "err" };

export function tagsFor(i: MenuItem, stat?: DishStat): Tag[] {
  if (soldOut(i)) return [{ label: "Épuisé", tone: "err" }];
  const tags: Tag[] = [];
  const left = remaining(i);
  if (left !== null && i.planned_qty && left <= Math.max(3, Math.round(i.planned_qty * 0.15))) {
    tags.push({ label: `Bientôt épuisé · ${left}`, tone: "warn" });
  }
  if (stat && (stat.avg_stars ?? 0) >= 4.2 && stat.ratings_count >= 40) tags.push({ label: "Populaire", tone: "lime" });
  return tags;
}

export const TAG_STYLE: Record<Tag["tone"], string> = {
  dark: "bg-ink text-white",
  lime: "bg-lime text-ink",
  warn: "bg-warn text-white",
  err: "bg-err text-white",
};

// ───────── Horaires des services (Africa/Abidjan = UTC+0 toute l'année) ─────────
export type ServiceConfig = { label: string; start: string; end: string; price: number; extras: boolean };
export type Services = Record<ServiceKind, ServiceConfig>;
export const DEFAULT_SERVICES: Services = {
  breakfast: { label: "Petit-déjeuner", start: "06:30", end: "09:30", price: 500, extras: false },
  lunch: { label: "Déjeuner", start: "11:30", end: "14:30", price: 2500, extras: true },
  snack: { label: "Snack", start: "15:30", end: "17:00", price: 700, extras: false },
  dinner: { label: "Dîner", start: "17:30", end: "20:00", price: 2500, extras: true },
};

export async function fetchServices(): Promise<Services> {
  const saved = readCache<Partial<Services>>("dabali:services") ?? {};
  if (!navigator.onLine) return { ...DEFAULT_SERVICES, ...saved };
  const { data } = await supabase().from("settings").select("value").eq("key", "services").maybeSingle();
  if (data?.value) writeCache("dabali:services", data.value);
  return { ...DEFAULT_SERVICES, ...((data?.value as Partial<Services>) ?? saved) };
}

/** Le service est-il terminé ? (l'achat est alors refusé par le serveur) */
export function serviceEnded(date: string, service: ServiceKind, services: Services | null, now = Date.now()) {
  const end = (services ?? DEFAULT_SERVICES)[service].end;
  return new Date(`${date}T${end}:00Z`).getTime() <= now;
}

/** Service en cours, sinon le prochain de la journée (sinon le petit-déjeuner du lendemain) */
export function currentService(services: Services | null, now = new Date()): ServiceKind {
  const cfg = services ?? DEFAULT_SERVICES;
  const hm = now.toISOString().slice(11, 16); // Abidjan = UTC
  const order: ServiceKind[] = ["breakfast", "lunch", "snack", "dinner"];
  return order.find((s) => hm < cfg[s].end) ?? "breakfast";
}
