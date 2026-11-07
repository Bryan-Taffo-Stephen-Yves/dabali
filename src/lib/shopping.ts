import { supabase } from "@/lib/supabase/client";

export type ShoppingStatus = "open" | "assigned" | "shopping" | "done" | "cancelled";
export type ShoppingList = {
  id: string; num: number; status: ShoppingStatus; note: string | null; spent_total: number | null;
  created_at: string; assigned_at: string | null; started_at: string | null; done_at: string | null;
  assigned_to: string | null; assignee: { full_name: string } | null;
};
export type ShoppingItem = {
  id: string; list_id: string; ingredient_id: string | null; label: string; qty: number; unit: string; est_cost: number;
  reason: string | null; source: "auto" | "manual"; urgent: boolean; status: "todo" | "bought" | "missing";
  bought_qty: number | null; paid: number | null; created_at: string;
};

export const LIST_COLUMNS = "id, num, status, note, spent_total, created_at, assigned_at, started_at, done_at, assigned_to, assignee:profiles!shopping_lists_assigned_to_fkey(full_name)";
export const ITEM_COLUMNS = "id, list_id, ingredient_id, label, qty, unit, est_cost, reason, source, urgent, status, bought_qty, paid, created_at";

export const listCode = (n: number) => `C-${String(n).padStart(4, "0")}`;
export const qtyLabel = (q: number, unit: string) => `${Number(q).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${unit}`;

export const STATUS_LABEL: Record<ShoppingStatus, string> = {
  open: "En préparation", assigned: "Attribuée", shopping: "Courses en cours", done: "Terminée", cancelled: "Annulée",
};

export async function fetchItems(listIds: string[]) {
  if (!listIds.length) return [] as ShoppingItem[];
  const { data } = await supabase().from("shopping_items").select(ITEM_COLUMNS).in("list_id", listIds)
    .order("urgent", { ascending: false }).order("est_cost", { ascending: false });
  return (data ?? []) as ShoppingItem[];
}
