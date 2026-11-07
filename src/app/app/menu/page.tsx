"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { Flame, Star, Plus, Sun, Moon } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { DishImage } from "@/components/app/dish-image";
import { fetchDishStats, fetchMenu, fetchServices, serviceEnded, soldOut, tagsFor, TAG_STYLE, type DishStat, type Services } from "@/lib/menu";
import { addDays, dayNum, dayShort, fcfa, todayISO } from "@/lib/format";
import type { MenuItem } from "@/lib/types";

type Category = { id: number; name: string };

export default function MenuPage() {
  return <Suspense><Menu /></Suspense>;
}

function Menu() {
  const router = useRouter();
  const params = useSearchParams();
  const today = todayISO();
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [stats, setStats] = useState<Record<string, DishStat>>({});
  const [cats, setCats] = useState<Category[]>([]);
  const [cat, setCat] = useState<number | null>(null);
  const [services, setServices] = useState<Services | null>(null);
  // On ne propose que les services encore ouverts à l'achat
  const open = (items ?? []).filter((i) => !serviceEnded(i.service_date, i.service, services));

  const days = useMemo(() => Array.from({ length: 8 }, (_, i) => addDays(today, i)), [today]);
  const available = useMemo(() => days.filter((d) => open.some((i) => i.service_date === d)), [days, open]);
  const day = params.get("jour") ?? available[0] ?? today;
  const openServices = (["lunch", "dinner"] as const).filter((s) => open.some((i) => i.service_date === day && i.service === s));
  const service = (params.get("service") as "lunch" | "dinner") ?? openServices[0] ?? "lunch";

  const go = (patch: Record<string, string>) => {
    const p = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => p.set(k, v));
    router.replace(`/app/menu?${p}`, { scroll: false });
  };

  useEffect(() => {
    fetchMenu(today, addDays(today, 7)).then(setItems);
    fetchDishStats().then(setStats);
    fetchServices().then(setServices);
    supabase().from("categories").select("id, name").order("sort").then(({ data }) => setCats(data ?? []));
    // Ruptures et ventes en direct (§4.3, §12 : grisé en < 3 s)
    const sb = supabase();
    const ch = sb.channel("menu-live")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "menu_items" }, (pl) => {
        const n = pl.new as Partial<MenuItem> & { id: string };
        setItems((l) => l?.map((i) => (i.id === n.id ? { ...i, sold_qty: n.sold_qty ?? i.sold_qty, is_sold_out: n.is_sold_out ?? i.is_sold_out, is_full: n.is_full ?? i.is_full, planned_qty: n.planned_qty ?? i.planned_qty } : i)) ?? l);
      })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [today]);

  const list = (items ?? []).filter((i) => i.service_date === day && i.service === service && (cat === null || i.dish.category_id === cat));
  list.sort((a, b) => Number(soldOut(a)) - Number(soldOut(b)));
  const servicesOfDay = new Set(openServices);

  return (
    <main>
      <header className="sticky top-0 z-30 bg-canvas/95 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur">
        <h1 className="py-1 text-[26px] font-extrabold tracking-tight">Menu de la semaine</h1>

        {/* Jours */}
        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {days.map((d) => {
            const has = available.includes(d);
            const active = d === day;
            return (
              <button key={d} disabled={!has} onClick={() => go({ jour: d })}
                className={clsx("flex w-14 shrink-0 flex-col items-center rounded-2xl py-2 transition",
                  active ? "bg-ink text-white" : "bg-card text-ink shadow-[var(--shadow-card)]", !has && "opacity-35")}>
                <span className={clsx("text-[11px] font-bold uppercase", active ? "text-lime" : "text-muted")}>{d === today ? "Auj." : dayShort(d)}</span>
                <span className="text-lg font-extrabold">{dayNum(d)}</span>
              </button>
            );
          })}
        </div>

        {/* Service */}
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-card p-1 shadow-[var(--shadow-card)]">
          {(["lunch", "dinner"] as const).map((s) => (
            <button key={s} onClick={() => go({ service: s, jour: day })} disabled={!servicesOfDay.has(s)}
              className={clsx("flex h-10 items-center justify-center gap-2 rounded-full text-sm font-bold transition disabled:opacity-35",
                service === s ? "bg-lime text-ink" : "text-muted")}>
              {s === "lunch" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              {s === "lunch" ? "Déjeuner" : "Dîner"}
            </button>
          ))}
        </div>

        {/* Catégories */}
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {[{ id: null, name: "Tout" } as { id: number | null; name: string }, ...cats].map((c) => (
            <button key={String(c.id)} onClick={() => setCat(c.id)}
              className={clsx("h-9 shrink-0 rounded-full border px-4 text-sm font-bold transition",
                cat === c.id ? "border-ink bg-ink text-white" : "border-line bg-card text-ink-2")}>
              {c.name}
            </button>
          ))}
        </div>
      </header>

      <section className="space-y-4 px-4 pt-3">
        {items === null && [0, 1, 2].map((i) => <div key={i} className="h-72 animate-pulse rounded-[24px] bg-card" />)}
        {items !== null && list.length === 0 && (
          <div className="rounded-[24px] border-2 border-dashed border-line p-8 text-center">
            <p className="font-bold">Rien dans cette catégorie</p>
            <p className="mt-1 text-sm text-muted">Essayez un autre jour ou un autre service.</p>
          </div>
        )}
        {list.map((i) => <DishCard key={i.id} item={i} stat={stats[i.dish.id]} ended={serviceEnded(i.service_date, i.service, services)} />)}
      </section>
    </main>
  );
}

function DishCard({ item, stat, ended }: { item: MenuItem; stat?: DishStat; ended?: boolean }) {
  const out = soldOut(item) || !!ended;
  const tags = ended ? [{ label: "Service terminé", tone: "dark" as const }] : tagsFor(item, stat);
  const inner = (
    <article className={clsx("overflow-hidden rounded-[24px] bg-card shadow-[var(--shadow-card)] transition", out ? "opacity-60" : "active:scale-[0.99]")}>
      <div className="relative">
        <DishImage name={item.dish.name} src={item.dish.photo_url} rounded="rounded-none" className={clsx("h-44 w-full", out && "grayscale")} />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {tags.map((t) => <span key={t.label} className={clsx("rounded-full px-2.5 py-1 text-[11px] font-extrabold shadow-sm", TAG_STYLE[t.tone])}>{t.label}</span>)}
        </div>
        {stat?.avg_stars != null && (
          <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-extrabold">
            <Star className="size-3.5 fill-warn text-warn" />{stat.avg_stars.toFixed(1)}<span className="font-semibold text-muted">({stat.ratings_count})</span>
          </span>
        )}
      </div>
      <div className="flex items-end gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-extrabold leading-snug">{item.dish.name}</h3>
          <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted">{item.dish.composition}</p>
          <div className="mt-2.5 flex items-center gap-3">
            <span className="text-lg font-extrabold">{fcfa(item.price)}</span>
            {item.dish.kcal && <span className="flex items-center gap-1 text-xs font-semibold text-muted"><Flame className="size-3.5" />{item.dish.kcal} kcal</span>}
          </div>
        </div>
        <span className={clsx("grid size-12 shrink-0 place-items-center rounded-full", out ? "bg-canvas text-off" : "bg-lime text-ink")}>
          <Plus className="size-6" strokeWidth={2.6} />
        </span>
      </div>
    </article>
  );
  return out ? <div aria-disabled>{inner}</div> : <Link href={`/app/menu/${item.id}`}>{inner}</Link>;
}
