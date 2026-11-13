"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { Check, Clock, ChefHat, Info } from "lucide-react";
import { rpc, supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/app/page-header";
import { ServiceIcon } from "@/components/app/service-icon";
import { DishImage } from "@/components/app/dish-image";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { PinPad } from "@/components/ui/pin-pad";
import { useToast } from "@/components/ui/toast";
import { useAppData } from "@/components/app/app-data";
import { buzz } from "@/lib/confetti";
import { fetchMenu, fetchServices, serviceEnded, soldOut, type Services } from "@/lib/menu";
import { syncTokens } from "@/lib/tickets";
import { addDays, dayNum, dayShort, fcfa, time, todayISO } from "@/lib/format";
import { SERVICES, type Extra, type MenuItem, type ServiceKind } from "@/lib/types";

type Slot = { at: string; left: number };
type Win = { open: string | null; close: string | null; paused?: boolean };
type OrderCfg = { windows?: Partial<Record<ServiceKind, Win>> };

/** État des commandes du jour pour un repas (plage fixée par la cuisine, pause) */
function windowState(win: Win | undefined, isToday: boolean, now = new Date()) {
  if (win?.paused) return { ok: false, text: "La cuisine a mis les commandes en pause. Réessaie un peu plus tard." };
  if (!isToday || !win?.open || !win?.close) return { ok: true, text: null };
  const hm = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Abidjan" });
  const range = `${win.open.replace(":", "h")} à ${win.close.replace(":", "h")}`;
  if (hm < win.open) return { ok: false, text: `Les commandes du jour ouvrent à ${win.open.replace(":", "h")} (de ${range}). Tu peux déjà précommander pour un autre jour.` };
  if (hm >= win.close) return { ok: false, text: `Les commandes du jour sont fermées (de ${range}). Précommande pour un autre jour.` };
  return { ok: true, text: `Commandes du jour ouvertes de ${range}.` };
}

/** Commande à heure de retrait : je choisis mon plat et l'heure, la cuisine prépare, je passe le prendre. */
export default function OrderPage() {
  return <Suspense><Order /></Suspense>;
}

function Order() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { balance, refresh } = useAppData();
  const today = todayISO();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [services, setServices] = useState<Services | null>(null);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [service, setService] = useState<ServiceKind | null>(null);
  const [itemId, setItemId] = useState<string | null>(params.get("item"));
  const [picked, setPicked] = useState<Record<string, string | null>>({ starter: null, dessert: null });
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ no: number; dish: string; at: string } | null>(null);
  const [orderCfg, setOrderCfg] = useState<OrderCfg>({});

  useEffect(() => {
    fetchMenu(today, addDays(today, 7)).then(setItems);
    fetchServices().then(setServices);
    supabase().from("extras").select("id, name, price, kind").eq("is_active", true).in("kind", ["starter", "dessert"]).order("sort")
      .then(({ data }) => setExtras((data ?? []) as Extra[]));
    supabase().from("settings").select("value").eq("key", "orders").maybeSingle()
      .then(({ data }) => data?.value && setOrderCfg(data.value as OrderCfg));
  }, [today]);

  // Repas encore commandables (service pas terminé)
  const open = useMemo(() => (items ?? []).filter((i) => !serviceEnded(i.service_date, i.service, services)), [items, services]);
  const days = useMemo(() => [...new Set(open.map((i) => i.service_date))].sort(), [open]);

  // Sélection initiale : le plat passé en paramètre, sinon le premier jour / repas disponible
  useEffect(() => {
    if (!items || day) return;
    const fromParam = open.find((i) => i.id === itemId);
    const d = fromParam?.service_date ?? days[0] ?? null;
    setDay(d);
    setService(fromParam?.service ?? (open.find((i) => i.service_date === d)?.service ?? null));
  }, [items, open, days, day, itemId]);

  const servicesOfDay = SERVICES.filter((s) => open.some((i) => i.service_date === day && i.service === s));
  const list = open.filter((i) => i.service_date === day && i.service === service);
  const item = list.find((i) => i.id === itemId) ?? null;
  const cfg = service && services ? services[service] : null;
  const withExtras = !!cfg?.extras;
  const chosenExtras = useMemo(() => (withExtras ? extras.filter((e) => picked[e.kind] === e.id) : []), [withExtras, extras, picked]);
  const total = (item?.price ?? 0) + chosenExtras.reduce((s, e) => s + e.price, 0);
  const needsPin = true; // chaque commande est confirmée par le titulaire (PIN)
  const win = windowState(service ? orderCfg.windows?.[service] : undefined, day === today);
  const insufficient = balance !== null && item !== null && balance < total;

  // Heure limite d'annulation : 1 h 30 avant le début du service
  const cancelUntil = cfg && day ? (() => {
    const [h, m] = cfg.start.split(":").map(Number);
    const mins = h * 60 + m - 90;
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}h${String(mins % 60).padStart(2, "0")}`;
  })() : null;

  // Créneaux du repas choisi
  useEffect(() => {
    if (!day || !service) return;
    setSlots(null); setSlot(null);
    rpc<Slot[]>("order_slots", { p_date: day, p_service: service }).then((r) => {
      const l = (Array.isArray(r) ? r : []) as Slot[];
      setSlots(l);
      setSlot(l.find((s) => s.left > 0)?.at ?? null);
    });
  }, [day, service]);

  const order = useCallback(async (pin?: string) => {
    if (!item || !slot) return;
    setBusy(true);
    const r = await rpc<{ ticket_id: string; order_no: number; dish: string; pickup_at: string }>("place_order", {
      p_menu_item_id: item.id, p_pickup_at: slot, p_extra_ids: chosenExtras.map((e) => e.id), p_pin: pin ?? null,
    });
    setBusy(false);
    if (!r.ok) {
      if (r.code === "PIN_NOT_SET") { setPinOpen(false); toast("err", "Crée d'abord ton code PIN."); router.push("/app/profil?pin=new&back=/app/commander"); return; }
      if (r.code.startsWith("PIN")) { setPinError(r.message); setPinOpen(true); return; }
      setPinOpen(false); toast("err", r.message);
      if (r.code === "SLOT_FULL" || r.code === "SLOT_TOO_SOON") rpc<Slot[]>("order_slots", { p_date: day, p_service: service }).then((s) => setSlots(Array.isArray(s) ? s as Slot[] : []));
      return;
    }
    setPinOpen(false);
    refresh();
    buzz([20, 60, 40]);
    setDone({ no: r.order_no, dish: r.dish, at: r.pickup_at });
    await Promise.all([syncTokens(), new Promise((ok) => setTimeout(ok, 2200))]);
    router.replace(`/app/tickets/${r.ticket_id}`);
  }, [item, slot, chosenExtras, day, service, refresh, router, toast]);

  const dayLabel = (d: string) => (d === today ? "aujourd'hui" : d === addDays(today, 1) ? "demain" : `${dayShort(d).toLowerCase()} ${dayNum(d)}`);

  return (
    <main className="pb-44">
      <PageHeader title="Commander un plat" />
      <div className="px-4">
        <p className="text-sm font-semibold text-muted">Choisis ton plat et ton heure : la cuisine le prépare, tu n&apos;as plus qu&apos;à passer le prendre.</p>

        {/* Jour */}
        <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {items === null && [0, 1, 2, 3].map((i) => <div key={i} className="h-[60px] w-14 shrink-0 animate-pulse rounded-2xl bg-card" />)}
          {days.map((d) => (
            <button key={d} onClick={() => { setDay(d); const s = open.find((i) => i.service_date === d)?.service ?? null; setService(s); setItemId(null); }}
              className={clsx("flex w-14 shrink-0 flex-col items-center rounded-2xl py-2 transition",
                d === day ? "bg-ink text-white" : "bg-card text-ink shadow-[var(--shadow-card)]")}>
              <span className={clsx("text-[11px] font-bold uppercase", d === day ? "text-lime" : "text-muted")}>{d === today ? "Auj." : dayShort(d)}</span>
              <span className="text-lg font-extrabold">{dayNum(d)}</span>
            </button>
          ))}
        </div>

        {/* Repas */}
        {servicesOfDay.length > 0 && (
          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {servicesOfDay.map((s) => (
              <button key={s} onClick={() => { setService(s); setItemId(null); }}
                className={clsx("flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-bold transition",
                  service === s ? "bg-lime text-ink" : "bg-card text-muted shadow-[var(--shadow-card)]")}>
                <ServiceIcon service={s} className="size-4" />{services?.[s].label ?? s}
              </button>
            ))}
          </div>
        )}

        {items !== null && days.length === 0 && (
          <div className="mt-6 rounded-[24px] border-2 border-dashed border-line p-8 text-center">
            <p className="font-bold">Pas encore de menu à commander</p>
            <p className="mt-1 text-sm text-muted">Le menu de la semaine n&apos;est pas encore publié.</p>
          </div>
        )}

        {win.text && (
          <p className={clsx("mt-4 rounded-2xl px-3.5 py-3 text-[13px] font-bold", win.ok ? "bg-ok-soft text-[#15803d]" : "bg-warn-soft text-ink")}>
            <Clock className="mr-1.5 inline size-4 align-[-3px]" />{win.text}
          </p>
        )}

        {/* Plat */}
        {list.length > 0 && (
          <section className="mt-5">
            <h2 className="text-[15px] font-extrabold">Ton plat</h2>
            <div className="mt-2 space-y-2.5">
              {list.map((i) => {
                const out = soldOut(i);
                const on = i.id === itemId;
                return (
                  <button key={i.id} disabled={out} onClick={() => setItemId(i.id)}
                    className={clsx("flex w-full items-center gap-3 rounded-[22px] border-2 bg-card p-2.5 pr-4 text-left transition active:scale-[0.99] disabled:opacity-45",
                      on ? "border-ink" : "border-transparent shadow-[var(--shadow-card)]")}>
                    <DishImage name={i.dish.name} src={i.dish.photo_url} className={clsx("size-16 shrink-0", out && "grayscale")} />
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold leading-tight">{i.dish.name}</p>
                      <p className="mt-0.5 text-sm font-bold text-ink-2">{out ? "Épuisé" : fcfa(i.price)}</p>
                    </div>
                    <span className={clsx("grid size-6 shrink-0 place-items-center rounded-full border-2", on ? "border-ink bg-ink" : "border-line")}>
                      {on && <Check className="size-3.5 text-lime" strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Entrée / dessert : un de chaque au plus */}
        {item && withExtras && extras.length > 0 && (
          <section className="mt-5">
            <h2 className="text-[15px] font-extrabold">En plus <span className="text-sm font-semibold text-muted">facultatif</span></h2>
            {([["starter", "Entrée"], ["dessert", "Dessert"]] as const).map(([kind, title]) => (
              <div key={kind} className="mt-2">
                <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">{title}</p>
                <div className="flex flex-wrap gap-2">
                  {extras.filter((e) => e.kind === kind).map((e) => {
                    const on = picked[kind] === e.id;
                    return (
                      <button key={e.id} onClick={() => setPicked((p) => ({ ...p, [kind]: on ? null : e.id }))}
                        className={clsx("rounded-full px-3.5 py-2 text-sm font-bold transition active:scale-95",
                          on ? "bg-ink text-white" : "bg-card text-ink shadow-[var(--shadow-card)]")}>
                        {e.name} <span className={on ? "text-lime" : "text-muted"}>+{fcfa(e.price)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Heure de retrait */}
        {item && (
          <section className="mt-5">
            <h2 className="flex items-center gap-1.5 text-[15px] font-extrabold"><Clock className="size-4" />Je passe le prendre {day ? dayLabel(day) : ""} à…</h2>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {slots === null && [0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-2xl bg-card" />)}
              {slots?.map((s) => (
                <button key={s.at} disabled={s.left === 0} onClick={() => setSlot(s.at)}
                  className={clsx("flex h-12 flex-col items-center justify-center rounded-2xl text-sm font-extrabold transition active:scale-95 disabled:opacity-35",
                    slot === s.at ? "bg-lime text-ink ring-2 ring-ink" : "bg-card shadow-[var(--shadow-card)]")}>
                  {time(s.at)}
                  {s.left === 0 ? <span className="text-[10px] font-bold text-err">complet</span>
                    : s.left <= 5 ? <span className="text-[10px] font-bold text-warn">{s.left} places</span> : null}
                </button>
              ))}
            </div>
            {slots?.length === 0 && <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-sm font-bold text-ink">Plus de créneau pour ce repas : choisis un autre jour.</p>}
            <p className="mt-3 flex gap-2 rounded-2xl bg-lime-soft px-3.5 py-3 text-[13px] font-semibold text-ink-2">
              <Info className="mt-0.5 size-4 shrink-0" />
              <span>À récupérer entre l&apos;heure choisie et {cfg?.end.replace(":", "h")}. Annulation remboursée jusqu&apos;à {cancelUntil} {day ? dayLabel(day) : ""}.
                <b className="text-ink"> Non récupérée à temps : le plat est perdu.</b></span>
            </p>
          </section>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md bg-gradient-to-t from-canvas via-canvas to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
        {insufficient && (
          <p className="mb-2 rounded-xl bg-err-soft px-3 py-2 text-center text-[13px] font-bold text-err">
            Solde insuffisant ({fcfa(balance ?? 0)}). <a href="/app/recharger" className="underline">Recharger</a>
          </p>
        )}
        <Button size="lg" block variant="dark" disabled={!item || !slot || insufficient || !win.ok} loading={busy}
          onClick={() => (needsPin ? (setPinError(null), setPinOpen(true)) : order())}>
          <span className="whitespace-nowrap">{item ? <>Commander{slot ? ` · ${time(slot)}` : ""} <span className="text-lime">·</span> {fcfa(total)}</> : "Choisis ton plat"}</span>
        </Button>
      </div>

      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Confirmer la commande">
        <p className="-mt-2 mb-4 text-sm text-muted">{item?.dish.name}{chosenExtras.length ? ` + ${chosenExtras.map((e) => e.name).join(" + ")}` : ""} · retrait {slot ? time(slot) : ""} · <b className="text-ink">{fcfa(total)}</b></p>
        <PinPad onComplete={(p) => order(p)} error={pinError} busy={busy} />
      </Sheet>

      {done && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-ink px-8 text-center text-white" role="status">
          <span className="animate-pop grid size-24 place-items-center rounded-full bg-lime text-ink"><ChefHat className="size-12" /></span>
          <p className="mt-6 text-sm font-bold uppercase tracking-wider text-lime">Commande n° {done.no}</p>
          <p className="mt-1 text-3xl font-extrabold">Envoyée en cuisine</p>
          <p className="mt-3 text-lg font-semibold text-white/80">{done.dish}<br />à récupérer à {time(done.at)}</p>
          <p className="mt-6 text-sm text-white/60">On te prévient dès qu&apos;elle est prête.</p>
        </div>
      )}
    </main>
  );
}
