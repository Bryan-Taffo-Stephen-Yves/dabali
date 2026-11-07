"use client";
import { supabase } from "@/lib/supabase/client";
import type { MenuItem } from "@/lib/types";

export const MENU_ITEM_COLUMNS =
  "id, service_date, service, price, planned_qty, sold_qty, is_sold_out, is_full, dish:dishes(id, name, category_id, description, composition, kcal, weight_g, allergens, photo_url, photo_credit, photo_source, base_price)";

export type DishStat = { dish_id: string; avg_stars: number | null; ratings_count: number };

export async function fetchMenu(from: string, to: string): Promise<MenuItem[]> {
  const { data } = await supabase().from("menu_items").select(MENU_ITEM_COLUMNS)
    .gte("service_date", from).lte("service_date", to).order("service_date").order("price", { ascending: false });
  return (data ?? []) as unknown as MenuItem[];
}

export async function fetchDishStats(): Promise<Record<string, DishStat>> {
  const { data } = await supabase().from("dish_stats").select("dish_id, avg_stars, ratings_count");
  return Object.fromEntries((data ?? []).map((s) => [s.dish_id, s as DishStat]));
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
export type Services = Record<"lunch" | "dinner", { label: string; start: string; end: string }>;
const DEFAULT_SERVICES: Services = {
  lunch: { label: "Déjeuner", start: "11:30", end: "14:30" },
  dinner: { label: "Dîner", start: "18:30", end: "21:00" },
};

export async function fetchServices(): Promise<Services> {
  const { data } = await supabase().from("settings").select("value").eq("key", "services").maybeSingle();
  return (data?.value as Services) ?? DEFAULT_SERVICES;
}

/** Le service est-il terminé ? (l'achat est alors refusé par le serveur) */
export function serviceEnded(date: string, service: "lunch" | "dinner", services: Services | null, now = Date.now()) {
  const end = (services ?? DEFAULT_SERVICES)[service].end;
  return new Date(`${date}T${end}:00Z`).getTime() <= now;
}
