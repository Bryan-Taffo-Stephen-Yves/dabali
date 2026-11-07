// Formatage FR / FCFA / Africa/Abidjan
export const TZ = "Africa/Abidjan";
const NBSP = " ";

/** 2500 → « 2 500 FCFA » (espaces insécables, pas de décimales) */
export function fcfa(n: number | null | undefined, withUnit = true): string {
  const s = Math.round(n ?? 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return withUnit ? `${s}${NBSP}FCFA` : s;
}

export function signedFcfa(n: number) {
  return (n > 0 ? "+" : n < 0 ? "−" : "") + fcfa(Math.abs(n));
}

/** Date du jour à Abidjan, au format YYYY-MM-DD */
export function todayISO(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekStart(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // lundi = 0
  return addDays(iso, -dow);
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, ...opts });

export const dayLong = (iso: string) => cap(fmt({ weekday: "long", day: "numeric", month: "long" }).format(new Date(iso + "T12:00:00Z")));
export const dayShort = (iso: string) => cap(fmt({ weekday: "short" }).format(new Date(iso + "T12:00:00Z")).replace(".", ""));
export const dayNum = (iso: string) => fmt({ day: "numeric" }).format(new Date(iso + "T12:00:00Z"));
export const dateTime = (ts: string) => fmt({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
export const time = (ts: string) => fmt({ hour: "2-digit", minute: "2-digit" }).format(new Date(ts)).replace(":", "h");

export function relativeDay(iso: string): string {
  const t = todayISO();
  if (iso === t) return "Aujourd'hui";
  if (iso === addDays(t, 1)) return "Demain";
  if (iso === addDays(t, -1)) return "Hier";
  return dayLong(iso);
}

export const SERVICE_LABEL: Record<string, string> = { breakfast: "Petit-déjeuner", lunch: "Déjeuner", snack: "Snack", dinner: "Dîner" };

/** « sam. 9 nov. à 14h05 » */
export const shortDateTime = (ts: string) =>
  fmt({ weekday: "short", day: "numeric", month: "short" }).format(new Date(ts)) + " à " + time(ts);

export function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** « 1 h 05 » / « 12 min » */
export function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}${NBSP}min`;
  const h = Math.floor(m / 60);
  if (h >= 48) return `${Math.floor(h / 24)}${NBSP}jours`;
  return `${h}${NBSP}h${NBSP}${String(m % 60).padStart(2, "0")}`;
}

export function firstName(full?: string | null) {
  return (full ?? "").split(" ")[0];
}
