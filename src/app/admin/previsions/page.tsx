"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { ShoppingCart, Download, Info } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Card, PageTitle, Badge, Empty, Kpi, downloadCsv } from "@/components/admin/ui";
import { ServiceBadge } from "@/components/app/service-icon";
import { ForecastBrief } from "@/components/admin/forecast-brief";
import { addDays, dayLong, dayShort, dayNum, fcfa, todayISO } from "@/lib/format";
import type { ServiceKind } from "@/lib/types";

type F = {
  services: { service: ServiceKind; label: string; history: number | null; outstanding: number; expected: number; basis: string }[];
  items: { id: string; service: ServiceKind; dish: string; planned: number | null; share: number; expected: number; recommended: number; basis: string }[];
  ingredients: { id: string; name: string; unit: string; stock: number; need: number; to_buy: number; cost: number }[];
};

const num = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

export default function ForecastPage() {
  const today = todayISO();
  const [date, setDate] = useState(addDays(today, 1));
  const [f, setF] = useState<F | null>(null);

  useEffect(() => {
    setF(null);
    supabase().rpc("admin_forecast", { p_date: date }).then(({ data }) => setF(data as F));
  }, [date]);

  const total = f?.items.reduce((s, i) => s + i.recommended, 0) ?? 0;
  const covers = f?.services.reduce((s, x) => s + x.expected, 0) ?? 0;
  const shopping = f?.ingredients.filter((i) => i.to_buy > 0) ?? [];
  const budget = shopping.reduce((s, i) => s + i.cost, 0);

  return (
    <>
      <PageTitle title="Prévisions" subtitle="Combien préparer, et quoi acheter, pour ne rien jeter">
        <div className="flex gap-1.5 overflow-x-auto">
          {Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => (
            <button key={d} onClick={() => setDate(d)}
              className={clsx("flex w-12 shrink-0 flex-col items-center rounded-xl py-1.5 text-xs font-bold", d === date ? "bg-ink text-white" : "border border-line bg-card")}>
              <span className={d === date ? "text-lime" : "text-muted"}>{dayShort(d)}</span><span className="text-base">{dayNum(d)}</span>
            </button>
          ))}
        </div>
      </PageTitle>

      <ForecastBrief date={date} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tone="dark" label="Repas attendus" value={f ? String(covers) : "…"} hint={dayLong(date)} />
        <Kpi label="Portions à préparer" value={f ? String(total) : "…"} hint="avec 5 % de marge" />
        <Kpi label="Tickets en circulation" value={f ? String(f.services.reduce((s, x) => s + x.outstanding, 0)) : "…"} hint="valables ce jour-là" />
        <Kpi tone="lime" label="Budget courses" value={f ? fcfa(budget) : "…"} hint={`${shopping.length} ingrédients à acheter`} />
      </div>

      {f && f.services.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {f.services.map((s) => (
            <div key={s.service} className="flex items-center gap-3 rounded-[22px] border border-line bg-card p-4">
              <ServiceBadge service={s.service} size="size-11" />
              <div>
                <p className="text-sm font-bold">{s.label}</p>
                <p className="text-2xl font-extrabold leading-tight">{s.expected}</p>
                <p className="text-xs text-muted">{s.history != null ? `moy. ${s.history} · ` : ""}{s.outstanding} tickets</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card title="Portions recommandées par plat" pad={false}
          action={f && <button onClick={() => downloadCsv(`previsions-${date}.csv`, [["Service", "Plat", "Part des choix (%)", "Attendus", "À préparer", "Prévu au menu"], ...f.items.map((i) => [f.services.find((s) => s.service === i.service)?.label ?? i.service, i.dish, i.share, i.expected, i.recommended, i.planned])])}
            className="mr-5 flex items-center gap-1.5 text-sm font-bold text-muted hover:text-ink"><Download className="size-4" />CSV</button>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-y border-line bg-canvas text-left text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-2.5">Plat</th><th className="px-2 text-right">Part</th><th className="px-2 text-right">Attendus</th>
                <th className="px-2 text-right">À préparer</th><th className="px-5 text-right">Prévu au menu</th></tr></thead>
              <tbody>
                {f?.items.length === 0 && <tr><td colSpan={5} className="p-5"><Empty>Pas de menu ce jour-là</Empty></td></tr>}
                {f?.services.map((s) => {
                  const rows = f.items.filter((i) => i.service === s.service);
                  if (!rows.length) return null;
                  return [
                    <tr key={s.service}><td colSpan={5} className="px-5 pb-1 pt-4 text-xs font-extrabold uppercase tracking-wider text-muted">{s.label} · {s.expected} repas attendus</td></tr>,
                    ...rows.map((i) => {
                      const over = i.planned != null && i.planned > i.recommended * 1.25;
                      const under = i.planned != null && i.planned < i.expected;
                      return (
                        <tr key={i.id} className="border-b border-line last:border-0">
                          <td className="px-5 py-3 font-bold">{i.dish}{i.basis !== "dish" && <span className="ml-2 text-xs font-medium text-muted">(nouveau)</span>}</td>
                          <td className="px-2 text-right text-muted">{i.share} %</td>
                          <td className="px-2 text-right">{i.expected}</td>
                          <td className="px-2 text-right"><span className="rounded-lg bg-lime px-2 py-1 font-extrabold">{i.recommended}</span></td>
                          <td className="px-5 text-right">{i.planned ?? "∞"} {over && <Badge tone="warn">trop</Badge>}{under && <Badge tone="err">pas assez</Badge>}</td>
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
          </div>
          <p className="flex gap-2 border-t border-line px-5 py-3 text-xs text-muted"><Info className="size-4 shrink-0" />
            Repas attendus = moyenne des 4 mêmes jours de semaine (au moins les tickets en circulation). Répartition entre plats = choix faits au comptoir quand ces plats étaient servis. + 5 % de marge.</p>
        </Card>

        <Card title="Liste de courses" subtitle="Besoins des recettes vs stock (seuil d'alerte conservé)"
          action={shopping.length > 0 && <button onClick={() => downloadCsv(`courses-${date}.csv`, [["Ingrédient", "À acheter", "Unité", "Coût estimé"], ...shopping.map((i) => [i.name, i.to_buy, i.unit, i.cost])])}
            className="flex items-center gap-1.5 text-sm font-bold text-muted hover:text-ink"><Download className="size-4" />CSV</button>}>
          <div className="space-y-2">
            {f?.ingredients.map((i) => (
              <div key={i.id} className={clsx("flex items-center gap-3 rounded-xl px-3 py-2.5", i.to_buy > 0 ? "bg-warn-soft" : "bg-canvas")}>
                {i.to_buy > 0 ? <ShoppingCart className="size-4 text-[#b45309]" /> : <span className="size-4 rounded-full bg-ok/80" />}
                <span className="flex-1 text-sm font-bold">{i.name}</span>
                <span className="text-right text-xs text-muted">besoin {num(i.need)} {i.unit} · stock {num(i.stock)}</span>
                {i.to_buy > 0 && <span className="w-24 text-right text-sm font-extrabold">+{num(i.to_buy)} {i.unit}</span>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
