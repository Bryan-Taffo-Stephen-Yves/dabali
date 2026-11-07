"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronLeft, Flame, Scale, Star, AlertTriangle, Check, Gift, Sparkles, Clock } from "lucide-react";
import { rpc, supabase } from "@/lib/supabase/client";
import { DishImage } from "@/components/app/dish-image";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { PinPad } from "@/components/ui/pin-pad";
import { RecipientSheet } from "@/components/app/recipient-sheet";
import { useToast } from "@/components/ui/toast";
import { useAppData } from "@/components/app/app-data";
import { MENU_ITEM_COLUMNS, fetchServices, remaining, serviceEnded, soldOut, type Services } from "@/lib/menu";
import { SERVICE_LABEL, fcfa, relativeDay, dateTime } from "@/lib/format";
import { syncTokens } from "@/lib/tickets";
import type { Extra, MenuItem } from "@/lib/types";

type Review = { id: string; stars: number; comment: string | null; author: string | null; created_at: string };

export default function DishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { profile, balance, refresh } = useAppData();
  const [item, setItem] = useState<MenuItem | null>(null);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [stat, setStat] = useState<{ avg_stars: number | null; ratings_count: number } | null>(null);
  const [useReward, setUseReward] = useState(false);
  const [gift, setGift] = useState<{ id: string; full_name: string } | null>(null);
  const [giftOpen, setGiftOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [services, setServices] = useState<Services | null>(null);
  useEffect(() => { fetchServices().then(setServices); }, []);

  useEffect(() => {
    const sb = supabase();
    sb.from("menu_items").select(MENU_ITEM_COLUMNS).eq("id", id).single().then(({ data }) => {
      const it = data as unknown as MenuItem | null;
      setItem(it);
      if (!it) return;
      sb.from("dish_reviews").select("id, stars, comment, author, created_at").eq("dish_id", it.dish.id)
        .not("comment", "is", null).order("created_at", { ascending: false }).limit(4).then(({ data }) => setReviews(data ?? []));
      sb.from("dish_stats").select("avg_stars, ratings_count").eq("dish_id", it.dish.id).single().then(({ data }) => setStat(data));
    });
    sb.from("extras").select("id, name, price, kind").eq("is_active", true).order("sort").then(({ data }) => setExtras((data ?? []) as Extra[]));
    const ch = sb.channel(`item-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "menu_items", filter: `id=eq.${id}` },
        (pl) => setItem((i) => (i ? { ...i, ...(pl.new as Partial<MenuItem>), dish: i.dish } : i)))
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [id]);

  const points = profile?.points ?? 0;
  const canReward = points >= 10;
  const pickedExtras = extras.filter((e) => picked.includes(e.id));
  const freeDessertId = useMemo(() => {
    if (!useReward) return null;
    return [...pickedExtras].filter((e) => e.kind === "dessert").sort((a, b) => b.price - a.price)[0]?.id ?? null;
  }, [useReward, pickedExtras]);
  const total = (item?.price ?? 0) + pickedExtras.reduce((s, e) => s + (e.id === freeDessertId ? 0 : e.price), 0);
  const needsPin = total > 5000 || !!gift;
  const insufficient = balance !== null && balance < total;

  const toggle = (e: Extra) => {
    setPicked((p) => {
      if (p.includes(e.id)) return p.filter((x) => x !== e.id);
      // une seule option par type (un dessert, une boisson)
      const sameKind = extras.filter((x) => x.kind === e.kind).map((x) => x.id);
      return [...p.filter((x) => !sameKind.includes(x)), e.id];
    });
  };

  const buy = useCallback(async (pin?: string) => {
    if (!item) return;
    setBusy(true);
    const r = await rpc<{ ticket_id: string; total: number }>("purchase_ticket", {
      p_menu_item_id: item.id, p_extra_ids: picked, p_pin: pin ?? null,
      p_beneficiary_id: gift?.id ?? null, p_use_reward: useReward && !!freeDessertId,
    });
    setBusy(false);
    if (!r.ok) {
      if (r.code.startsWith("PIN")) { setPinError(r.message); setPinOpen(true); return; }
      setPinOpen(false);
      toast("err", r.message);
      return;
    }
    setPinOpen(false);
    refresh();
    if (gift) {
      toast("ok", `Repas offert à ${gift.full_name.split(" ")[0]} 🎁`);
      router.replace("/app");
    } else {
      await syncTokens();
      toast("ok", "Ticket acheté. Bon appétit !");
      router.replace(`/app/tickets/${r.ticket_id}?nouveau=1`);
    }
  }, [item, picked, gift, useReward, freeDessertId, refresh, router, toast]);

  if (!item) {
    return <div className="p-4"><div className="h-72 animate-pulse rounded-[28px] bg-card" /><div className="mt-4 h-40 animate-pulse rounded-[24px] bg-card" /></div>;
  }

  const ended = serviceEnded(item.service_date, item.service, services);
  const out = soldOut(item) || ended;
  const left = remaining(item);

  return (
    <main className="pb-36">
      <div className="relative">
        <DishImage name={item.dish.name} src={item.dish.photo_url} rounded="rounded-b-[32px]" className={clsx("h-[300px] w-full", out && "grayscale")} />
        <button onClick={() => router.back()} aria-label="Retour"
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] grid size-11 place-items-center rounded-full bg-white/95 shadow-[var(--shadow-card)]">
          <ChevronLeft className="size-5" />
        </button>
        {item.dish.photo_credit && (
          <a href={item.dish.photo_source ?? undefined} target="_blank" rel="noreferrer"
            className="absolute bottom-4 left-4 max-w-[55%] truncate rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-semibold text-white/90 backdrop-blur">
            {item.dish.photo_credit}
          </a>
        )}
        {stat?.avg_stars != null && (
          <span className="absolute bottom-4 right-4 flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-sm font-extrabold shadow-[var(--shadow-card)]">
            <Star className="size-4 fill-warn text-warn" />{stat.avg_stars.toFixed(1)}<span className="font-semibold text-muted">· {stat.ratings_count} avis</span>
          </span>
        )}
      </div>

      <div className="px-4">
        <div className="mt-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-bold text-lime-deep">{relativeDay(item.service_date)} · {SERVICE_LABEL[item.service]}</p>
            <h1 className="mt-1 text-[26px] font-extrabold leading-tight tracking-tight">{item.dish.name}</h1>
          </div>
          <p className="shrink-0 pt-6 text-xl font-extrabold">{fcfa(item.price)}</p>
        </div>
        {item.dish.description && <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{item.dish.description}</p>}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Info icon={Flame} label="Énergie" value={item.dish.kcal ? `${item.dish.kcal} kcal` : "—"} />
          <Info icon={Scale} label="Portion" value={item.dish.weight_g ? `${item.dish.weight_g} g` : "—"} />
          <Info icon={Clock} label="Restant" value={ended ? "Terminé" : out ? "Épuisé" : left === null ? "∞" : `${left} portions`} warn={!out && left !== null && left <= 5} />
        </div>

        <Block title="Composition"><p className="text-[15px] text-ink-2">{item.dish.composition}</p></Block>
        {item.dish.allergens.length > 0 && (
          <Block title="Allergènes">
            <div className="flex flex-wrap gap-2">
              {item.dish.allergens.map((a) => (
                <span key={a} className="flex items-center gap-1 rounded-full bg-warn-soft px-3 py-1 text-[13px] font-bold capitalize text-[#b45309]">
                  <AlertTriangle className="size-3.5" />{a}
                </span>
              ))}
            </div>
          </Block>
        )}

        {!out && (
          <Block title="Options">
            <div className="space-y-2">
              {extras.map((e) => {
                const on = picked.includes(e.id);
                const free = e.id === freeDessertId;
                return (
                  <button key={e.id} onClick={() => toggle(e)}
                    className={clsx("flex w-full items-center gap-3 rounded-2xl border-2 bg-card px-4 py-3 text-left transition",
                      on ? "border-ink" : "border-transparent shadow-[var(--shadow-card)]")}>
                    <span className={clsx("grid size-6 place-items-center rounded-lg border-2", on ? "border-ink bg-ink" : "border-line")}>
                      {on && <Check className="size-4 text-lime" strokeWidth={3} />}
                    </span>
                    <span className="flex-1 font-semibold">{e.name}<span className="ml-2 text-xs font-medium text-muted">{e.kind === "dessert" ? "Dessert" : e.kind === "drink" ? "Boisson" : ""}</span></span>
                    <span className={clsx("font-bold", free && "text-muted line-through")}>+{fcfa(e.price)}</span>
                    {free && <span className="rounded-full bg-lime px-2 py-0.5 text-xs font-extrabold">Offert</span>}
                  </button>
                );
              })}
            </div>
            {canReward && (
              <button onClick={() => setUseReward((v) => !v)}
                className={clsx("mt-3 flex w-full items-center gap-3 rounded-2xl p-3.5 text-left transition", useReward ? "bg-lime" : "bg-lime-soft")}>
                <Sparkles className="size-5 shrink-0" />
                <span className="flex-1 text-sm font-bold">Utiliser 10 points : dessert offert<span className="block text-xs font-medium text-ink-2">Vous avez {points} points{useReward && !freeDessertId ? " · choisissez un dessert" : ""}</span></span>
                <span className={clsx("h-6 w-10 rounded-full p-0.5 transition", useReward ? "bg-ink" : "bg-white")}>
                  <span className={clsx("block size-5 rounded-full transition", useReward ? "translate-x-4 bg-lime" : "bg-line")} />
                </span>
              </button>
            )}
          </Block>
        )}

        {!out && (
          <button onClick={() => (gift ? setGift(null) : setGiftOpen(true))}
            className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-card p-3.5 text-left shadow-[var(--shadow-card)]">
            <span className="grid size-10 place-items-center rounded-xl bg-canvas"><Gift className="size-5" /></span>
            <span className="flex-1 text-sm font-bold">{gift ? `Offert à ${gift.full_name}` : "Offrir ce repas"}
              <span className="block text-xs font-medium text-muted">{gift ? "Touchez pour annuler" : "Le ticket arrive directement chez la personne"}</span>
            </span>
          </button>
        )}

        {reviews.length > 0 && (
          <Block title="Avis récents">
            <div className="space-y-2.5">
              {reviews.map((r) => (
                <div key={r.id} className="rounded-2xl bg-card p-3.5 shadow-[var(--shadow-card)]">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">{r.author ?? "Client"}</span>
                    <span className="flex">{Array.from({ length: 5 }, (_, k) => <Star key={k} className={clsx("size-3.5", k < r.stars ? "fill-warn text-warn" : "text-line")} />)}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-2">{r.comment}</p>
                  <p className="mt-1 text-[11px] text-off">{dateTime(r.created_at)}</p>
                </div>
              ))}
            </div>
          </Block>
        )}
      </div>

      {/* Barre d'achat */}
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md bg-gradient-to-t from-canvas via-canvas to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
        {insufficient && !out && (
          <p className="mb-2 rounded-xl bg-err-soft px-3 py-2 text-center text-[13px] font-bold text-err">
            Solde insuffisant ({fcfa(balance ?? 0)}). <a href="/app/recharger" className="underline">Recharger</a>
          </p>
        )}
        <Button size="lg" block variant={out ? "outline" : "dark"} disabled={out || insufficient} loading={busy}
          onClick={() => (needsPin ? (setPinError(null), setPinOpen(true)) : buy())}>
          {ended ? "Service terminé" : out ? "Épuisé" : <>Acheter <span className="text-lime">·</span> {fcfa(total)}</>}
        </Button>
      </div>

      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Confirmer l'achat">
        <p className="-mt-2 mb-4 text-sm text-muted">{gift ? `Repas offert à ${gift.full_name}` : item.dish.name} · <b className="text-ink">{fcfa(total)}</b></p>
        <PinPad onComplete={(p) => buy(p)} error={pinError} busy={busy} />
      </Sheet>

      <RecipientSheet title="Offrir un repas" open={giftOpen} onClose={() => setGiftOpen(false)} onPick={(u) => { setGift(u); setGiftOpen(false); }} />
    </main>
  );
}

function Info({ icon: I, label, value, warn }: { icon: typeof Flame; label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl bg-card p-3 shadow-[var(--shadow-card)]">
      <I className={clsx("size-4", warn ? "text-warn" : "text-muted")} />
      <p className="mt-1.5 text-[11px] font-semibold text-muted">{label}</p>
      <p className={clsx("text-sm font-extrabold", warn && "text-[#b45309]")}>{value}</p>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2.5 text-[15px] font-extrabold">{title}</h2>
      {children}
    </section>
  );
}
