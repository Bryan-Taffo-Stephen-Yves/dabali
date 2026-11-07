"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronLeft, Flame, Scale, Star, AlertTriangle, Clock, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { DishImage } from "@/components/app/dish-image";
import { MENU_ITEM_COLUMNS, fetchServices, remaining, soldOut, type Services } from "@/lib/menu";
import { fcfa, relativeDay, dateTime } from "@/lib/format";
import type { MenuItem } from "@/lib/types";

type Review = { id: string; stars: number; comment: string | null; author: string | null; created_at: string };

/** Fiche plat : informations et avis. Le plat se choisit au comptoir avec un ticket du service. */
export default function DishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [item, setItem] = useState<MenuItem | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [stat, setStat] = useState<{ avg_stars: number | null; ratings_count: number } | null>(null);
  const [services, setServices] = useState<Services | null>(null);

  useEffect(() => {
    const sb = supabase();
    fetchServices().then(setServices);
    sb.from("menu_items").select(MENU_ITEM_COLUMNS).eq("id", id).single().then(({ data }) => {
      const it = data as unknown as MenuItem | null;
      setItem(it);
      if (!it) return;
      sb.from("dish_reviews").select("id, stars, comment, author, created_at").eq("dish_id", it.dish.id)
        .not("comment", "is", null).order("created_at", { ascending: false }).limit(4).then(({ data }) => setReviews(data ?? []));
      sb.from("dish_stats").select("avg_stars, ratings_count").eq("dish_id", it.dish.id).single().then(({ data }) => setStat(data));
    });
    const ch = sb.channel(`item-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "menu_items", filter: `id=eq.${id}` },
        (pl) => setItem((i) => (i ? { ...i, ...(pl.new as Partial<MenuItem>), dish: i.dish } : i)))
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [id]);

  if (!item) {
    return <div className="p-4"><div className="h-72 animate-pulse rounded-[28px] bg-card" /><div className="mt-4 h-40 animate-pulse rounded-[24px] bg-card" /></div>;
  }
  const out = soldOut(item);
  const left = remaining(item);
  const cfg = services?.[item.service];

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
        <p className="mt-5 text-[13px] font-bold text-lime-deep">{relativeDay(item.service_date)} · {cfg?.label ?? ""}</p>
        <h1 className="mt-1 text-[26px] font-extrabold leading-tight tracking-tight">{item.dish.name}</h1>
        {item.dish.description && <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{item.dish.description}</p>}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Info icon={Flame} label="Énergie" value={item.dish.kcal ? `${item.dish.kcal} kcal` : "—"} />
          <Info icon={Scale} label="Portion" value={item.dish.weight_g ? `${item.dish.weight_g} g` : "—"} />
          <Info icon={Clock} label="Restant" value={out ? "Épuisé" : left === null ? "∞" : `${left} portions`} warn={!out && left !== null && left <= 5} />
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

      {cfg && (
        <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md bg-gradient-to-t from-canvas via-canvas to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
          <p className="mb-2 text-center text-xs font-semibold text-muted">Avec un ticket {cfg.label}, choisissez ce plat au comptoir.</p>
          <Link href={`/app/acheter?service=${item.service}`}
            className="flex h-14 items-center justify-center gap-2 rounded-full bg-ink text-base font-bold text-white active:scale-[0.99]">
            Acheter un ticket {cfg.label} <span className="text-lime">·</span> {fcfa(cfg.price)} <ChevronRight className="size-5" />
          </Link>
        </div>
      )}
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
