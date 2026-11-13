"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { BellRing, ChefHat, Check, Clock, PackageCheck, Pause, Play } from "lucide-react";
import { rpc, supabase } from "@/lib/supabase/client";
import { Badge, Empty, PageTitle, Segmented } from "@/components/admin/ui";
import { Bitmoji } from "@/components/bitmoji";
import { DishImage } from "@/components/app/dish-image";
import { useToast } from "@/components/ui/toast";
import { addDays, dayLong, time, todayISO } from "@/lib/format";
import { say, soundOk } from "@/lib/scan-sounds";
import { SERVICES, type Extra, type ServiceKind } from "@/lib/types";
import { fetchServices, type Services } from "@/lib/menu";

type Order = {
  id: string; no: number; client: string; short_code: string | null; avatar: string | null; user_id: string;
  dish: string; photo_url: string | null; extras: Extra[]; pickup_at: string;
  prep_status: "received" | "preparing" | "ready"; status: "valid" | "used" | "expired"; ready_at: string | null; used_at: string | null;
};

const COLS = [
  { key: "received", title: "Reçues", tone: "bg-canvas", next: "preparing", action: "Je prépare" },
  { key: "preparing", title: "En préparation", tone: "bg-warn-soft", next: "ready", action: "Prête" },
  { key: "ready", title: "Prêtes · à récupérer", tone: "bg-lime-soft", next: null, action: null },
] as const;

/** Écran cuisine : les commandes arrivent en direct (son + voix), le chef les fait avancer. Le client est prévenu quand c'est prêt. */
export default function KitchenOrders() {
  const toast = useToast();
  const today = todayISO();
  const [day, setDay] = useState(today);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const known = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    const r = await rpc<{ orders: Order[] }>("kitchen_orders", { p_date: day });
    if (!r.ok) { toast("err", r.message); return; }
    const list = r.orders ?? [];
    // Nouvelle commande du jour : son + annonce vocale
    if (known.current && day === today) {
      const fresh = list.filter((o) => !known.current!.has(o.id));
      if (fresh.length) { soundOk(); say(fresh.length === 1 ? `Nouvelle commande, numéro ${fresh[0].no}, ${fresh[0].dish}` : `${fresh.length} nouvelles commandes`); }
    }
    known.current = new Set(list.map((o) => o.id));
    setOrders(list);
  }, [day, today, toast]);

  useEffect(() => {
    known.current = null; setOrders(null);
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 8000);
    return () => clearInterval(id);
  }, [load]);

  async function move(o: Order, status: "preparing" | "ready" | "received") {
    setBusy(o.id);
    const r = await rpc("set_order_status", { p_ticket_id: o.id, p_status: status });
    setBusy(null);
    if (!r.ok) return toast("err", r.message);
    if (status === "ready") toast("ok", `n° ${o.no} prête : ${o.client.split(" ")[0]} est prévenu.`);
    load();
  }

  const active = (orders ?? []).filter((o) => o.status === "valid");
  const done = (orders ?? []).filter((o) => o.status !== "valid");
  // À préparer par créneau : « 12h30 · 8 Attiéké, 5 Garba »
  const bySlot = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const o of active.filter((x) => x.prep_status !== "ready")) {
      const s = m.get(o.pickup_at) ?? new Map<string, number>();
      s.set(o.dish, (s.get(o.dish) ?? 0) + 1);
      m.set(o.pickup_at, s);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [active]);

  return (
    <div>
      <OrderHours />

      <PageTitle title="Commandes" subtitle={`${dayLong(day)} · mise à jour automatique`}>
        <Segmented value={day === today ? "today" : "tomorrow"} onChange={(v) => setDay(v === "today" ? today : addDays(today, 1))}
          options={[["today", "Aujourd'hui"], ["tomorrow", "Demain"]]} />
      </PageTitle>

      {bySlot.length > 0 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {bySlot.map(([at, dishes]) => (
            <div key={at} className="shrink-0 rounded-2xl bg-ink px-4 py-2.5 text-white">
              <p className="flex items-center gap-1.5 text-sm font-extrabold text-lime"><Clock className="size-4" />{time(at)}</p>
              <p className="text-sm font-bold">{[...dishes.entries()].map(([d, n]) => `${n} ${d}`).join(" · ")}</p>
            </div>
          ))}
        </div>
      )}

      {orders === null ? (
        <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-64 animate-pulse rounded-3xl bg-card" />)}</div>
      ) : orders.length === 0 ? (
        <Empty>Aucune commande pour ce jour. Elles arrivent ici dès qu&apos;un client commande (avec un son).</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLS.map((c) => {
            const list = active.filter((o) => o.prep_status === c.key);
            return (
              <section key={c.key} className={clsx("rounded-3xl p-3", c.tone)}>
                <h2 className="mb-3 flex items-center justify-between px-1 font-extrabold">
                  {c.title}<span className="grid min-w-7 place-items-center rounded-full bg-ink px-2 py-0.5 text-sm text-lime">{list.length}</span>
                </h2>
                <div className="space-y-2.5">
                  {list.length === 0 && <p className="px-1 py-6 text-center text-sm font-semibold text-muted">—</p>}
                  {list.map((o) => (
                    <article key={o.id} className="rounded-2xl bg-card p-3 shadow-[var(--shadow-card)]">
                      <div className="flex items-start gap-3">
                        <DishImage name={o.dish} src={o.photo_url} className="size-14 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 text-xs font-extrabold text-muted">n° {o.no}<span className="flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 text-lime"><Clock className="size-3" />{time(o.pickup_at)}</span></p>
                          <p className="mt-0.5 text-[15px] font-extrabold leading-tight">{o.dish}</p>
                          {o.extras.length > 0 && <p className="text-xs font-bold text-ink-2">+ {o.extras.map((e) => e.name).join(" + ")}</p>}
                          <p className="mt-1 flex items-center gap-1.5 truncate text-xs font-semibold text-muted">
                            <Bitmoji avatar={o.avatar} seed={o.user_id} className="size-5" />{o.client}{o.short_code ? ` · ${o.short_code}` : ""}
                          </p>
                        </div>
                      </div>
                      {c.next ? (
                        <button disabled={busy === o.id} onClick={() => move(o, c.next!)}
                          className={clsx("mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-extrabold transition active:scale-[0.98] disabled:opacity-50",
                            c.next === "ready" ? "bg-lime text-ink" : "bg-ink text-white")}>
                          {c.next === "ready" ? <BellRing className="size-4" /> : <ChefHat className="size-4" />}{c.action}
                        </button>
                      ) : (
                        <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-[#15803d]"><Check className="size-4" />Client prévenu{o.ready_at ? ` à ${time(o.ready_at)}` : ""} · au comptoir, scanner son QR</p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-extrabold">Terminées</h2>
          <div className="flex flex-wrap gap-2">
            {done.map((o) => (
              <span key={o.id} className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-sm font-bold shadow-[var(--shadow-card)]">
                {o.status === "used" ? <PackageCheck className="size-4 text-ok" /> : null}n° {o.no} · {o.dish}
                <Badge tone={o.status === "used" ? "ok" : "err"}>{o.status === "used" ? "récupérée" : "non récupérée"}</Badge>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

type Win = { open: string | null; close: string | null; paused?: boolean };

/** Horaires de commande par repas (commandes du jour) + pause immédiate. Les précommandes pour les jours suivants restent ouvertes. */
function OrderHours() {
  const toast = useToast();
  const [services, setServices] = useState<Services | null>(null);
  const [wins, setWins] = useState<Partial<Record<ServiceKind, Win>>>({});
  const [draft, setDraft] = useState<Partial<Record<ServiceKind, Win>>>({});
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<ServiceKind | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase().from("settings").select("value").eq("key", "orders").maybeSingle();
    const w = ((data?.value as { windows?: Partial<Record<ServiceKind, Win>> } | null)?.windows) ?? {};
    setWins(w); setDraft(w);
  }, []);
  useEffect(() => { fetchServices().then(setServices); load(); }, [load]);

  async function save(s: ServiceKind, patch: Partial<Win>) {
    const cur = { open: null, close: null, paused: false, ...draft[s], ...patch };
    setSaving(s);
    const r = await rpc("set_order_window", { p_service: s, p_open: cur.open || null, p_close: cur.close || null, p_paused: !!cur.paused });
    setSaving(null);
    if (!r.ok) return toast("err", r.message);
    toast("ok", patch.paused !== undefined ? (cur.paused ? "Commandes en pause." : "Commandes rouvertes.") : "Horaires enregistrés.");
    load();
  }

  const paused = SERVICES.filter((s) => wins[s]?.paused);
  return (
    <section className="mb-5 rounded-3xl bg-card p-4 shadow-[var(--shadow-card)]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span>
          <span className="flex items-center gap-2 font-extrabold"><Clock className="size-4" />Horaires de commande</span>
          <span className="block text-sm font-semibold text-muted">
            {SERVICES.filter((s) => wins[s]?.open).map((s) => `${services?.[s].label ?? s} ${wins[s]!.open!.replace(":", "h")}–${wins[s]!.close!.replace(":", "h")}`).join(" · ") || "Pas de plage : commandes ouvertes toute la journée"}
            {paused.length > 0 && <span className="ml-1 font-extrabold text-err">· en pause : {paused.map((s) => services?.[s].label ?? s).join(", ")}</span>}
          </span>
        </span>
        <span className="text-sm font-bold text-muted">{open ? "Fermer" : "Régler"}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-2.5">
          <p className="text-xs font-semibold text-muted">Plage pendant laquelle on peut commander pour le jour même. Les précommandes pour les jours suivants restent possibles. Laissez vide pour ne pas limiter.</p>
          {SERVICES.map((s) => {
            const w = draft[s] ?? { open: null, close: null };
            return (
              <div key={s} className="flex flex-wrap items-center gap-2 rounded-2xl bg-canvas p-2.5">
                <span className="w-28 text-sm font-extrabold">{services?.[s].label ?? s}</span>
                <input type="time" value={w.open ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [s]: { ...w, open: e.target.value || null } }))}
                  className="h-9 rounded-xl border border-line bg-card px-2 text-sm font-bold" aria-label={`Ouverture ${s}`} />
                <span className="text-sm font-bold text-muted">→</span>
                <input type="time" value={w.close ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [s]: { ...w, close: e.target.value || null } }))}
                  className="h-9 rounded-xl border border-line bg-card px-2 text-sm font-bold" aria-label={`Fermeture ${s}`} />
                <button disabled={saving === s} onClick={() => save(s, {})} className="h-9 rounded-full bg-ink px-4 text-sm font-bold text-white disabled:opacity-50">Enregistrer</button>
                <button disabled={saving === s} onClick={() => save(s, { ...wins[s], paused: !wins[s]?.paused })}
                  className={clsx("ml-auto flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-extrabold disabled:opacity-50", wins[s]?.paused ? "bg-lime text-ink" : "bg-err-soft text-err")}>
                  {wins[s]?.paused ? <><Play className="size-4" />Rouvrir</> : <><Pause className="size-4" />Pause</>}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
