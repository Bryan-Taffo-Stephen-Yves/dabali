export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  short_code: string;
  role: "client" | "agent" | "caissier" | "chef" | "admin";
  points: number;
  is_blocked: boolean;
  notify_free_seats: boolean;
};

export type ServiceKind = "breakfast" | "lunch" | "snack" | "dinner";
export const SERVICES: ServiceKind[] = ["breakfast", "lunch", "snack", "dinner"];

export type Extra = { id: string; name: string; price: number; kind: "starter" | "dessert" | "drink" | "other"; free?: boolean };

export type Dish = {
  id: string;
  name: string;
  category_id: number | null;
  description: string | null;
  composition: string | null;
  kcal: number | null;
  weight_g: number | null;
  allergens: string[];
  photo_url: string | null;
  photo_credit?: string | null;
  photo_source?: string | null;
  base_price: number;
};

export type MenuItem = {
  id: string;
  service_date: string;
  service: ServiceKind;
  price: number;
  planned_qty: number | null;
  sold_qty: number;
  is_sold_out: boolean;
  is_full: boolean;
  dish: Dish;
};

export type TicketStatus = "valid" | "used" | "expired" | "cancelled";
export type Ticket = {
  id: string;
  user_id: string;
  buyer_id: string;
  status: TicketStatus;
  service_date: string | null;
  service: ServiceKind;
  is_reward: boolean;
  gift_from: string | null;
  valid_from: string;
  valid_until: string;
  used_at: string | null;
  total: number;
  extras: Extra[];
  created_at: string;
  dish: Pick<Dish, "id" | "name" | "photo_url" | "composition"> | null;
};

export const TICKET_COLUMNS =
  "id, user_id, buyer_id, status, service_date, service, is_reward, gift_from, valid_from, valid_until, used_at, total, extras, created_at, dish:dishes(id, name, photo_url, composition)";

export const PROFILE_COLUMNS = "id, full_name, phone, short_code, role, points, is_blocked, notify_free_seats";

export type Occupancy =
  | { status: "unknown" }
  | { status: "closed"; room: string; next: { service: ServiceKind; starts_at: string } | null }
  | {
      status: "open"; room: string; service: ServiceKind; rate: number; level: "low" | "mid" | "high";
      occupied_tables: number; total_tables: number; wait_min: number; source: "vision" | "scans"; updated_at: string;
      queue_count?: number | null; wait_source?: "queue" | "estimate";
    };
