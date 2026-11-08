"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Heart } from "lucide-react";
import { DishImage } from "@/components/app/dish-image";
import { ServiceIcon } from "@/components/app/service-icon";
import { fetchMenu, fetchServices, serviceEnded, soldOut, type Services } from "@/lib/menu";
import { addDays, dayLong, todayISO } from "@/lib/format";
import { SERVICES, type MenuItem, type ServiceKind } from "@/lib/types";

/** Accueil : le prochain service avec ses plats en photo, et le plat préféré de l'étudiant s'il est au menu. */
export function NextMenu({ favorite }: { favorite?: string | null }) {
  const [next, setNext] = useState<{ date: string; service: ServiceKind; items: MenuItem[]; services: Services } | null | undefined>(undefined);

  useEffect(() => {
    const today = todayISO();
    Promise.all([fetchMenu(today, addDays(today, 6)), fetchServices()]).then(([items, services]) => {
      const slots = [...new Set(items.map((i) => `${i.service_date}|${i.service}`))]
        .map((k) => { const [date, service] = k.split("|") as [string, ServiceKind]; return { date, service }; })
        .filter((s) => !serviceEnded(s.date, s.service, services))
        .sort((a, b) => a.date.localeCompare(b.date) || SERVICES.indexOf(a.service) - SERVICES.indexOf(b.service));
      const s = slots[0];
      setNext(s ? { ...s, services, items: items.filter((i) => i.service_date === s.date && i.service === s.service && !soldOut(i)) } : null);
    }).catch(() => setNext(null));
  }, []);

  if (next === undefined) return <div className="h-48 animate-pulse rounded-[24px] bg-card" />;
  if (!next) return null;

  const today = todayISO();
  const when = next.date === today ? "Aujourd'hui" : next.date === addDays(today, 1) ? "Demain" : dayLong(next.date);
  const fav = favorite ? next.items.find((i) => i.dish.name === favorite) : undefined;
  const shown = [...(fav ? [fav] : []), ...next.items.filter((i) => i !== fav)].slice(0, 6);
  const href = `/app/menu?jour=${next.date}&service=${next.service}`;

  return (
    <section>
      <Link href={href} className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[17px] font-extrabold">
          <ServiceIcon service={next.service} className="size-4" />{when} · {next.services[next.service].label}
        </h2>
        <span className="flex items-center text-sm font-bold text-muted">Menu<ChevronRight className="size-4" /></span>
      </Link>
      {fav && (
        <Link href={`/app/menu/${fav.id}`} className="animate-rise mb-3 flex items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-sm font-bold text-white">
          <Heart className="size-4 fill-lime text-lime" />Votre plat préféré est au menu : <span className="truncate text-lime">{fav.dish.name}</span>
        </Link>
      )}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {shown.map((i) => (
          <Link key={i.id} href={`/app/menu/${i.id}`} className="w-36 shrink-0 snap-start overflow-hidden rounded-[20px] bg-card shadow-[var(--shadow-card)] transition active:scale-95">
            <DishImage name={i.dish.name} src={i.dish.photo_url} rounded="rounded-none" className="h-24 w-full" />
            <p className="line-clamp-2 p-2.5 text-[13px] font-bold leading-tight">{i.dish.name}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
