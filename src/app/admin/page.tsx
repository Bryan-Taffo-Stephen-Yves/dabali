"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Banknote, Ticket, UtensilsCrossed, Clock4, ShoppingBasket, AlertTriangle, Info, CircleAlert, Users, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Card, Kpi, PageTitle, Badge, Empty } from "@/components/admin/ui";
import { Columns, Meter } from "@/components/admin/charts";
import { DishImage } from "@/components/app/dish-image";
import { useStaff } from "@/components/admin/admin-shell";
import { dayLong, fcfa, todayISO, SERVICE_LABEL, time } from "@/lib/format";
import type { Occupancy } from "@/lib/types";

type Overview = {
  revenue: number; recharges: number; recharges_cash: number; sold: number; served: number; expired: number; outstanding: number;
  avg_basket: number; sold_out: number; occupancy: Occupancy;
  by_hour: { h: number; sales: number; scans: number }[];
  top_dishes: { name: string; photo_url: string | null; sold: number }[];
  services: { service: string; label: string; served: number; outstanding: number; planned: number | null }[];
  alerts: { kind: string; level: "warn" | "err" | "info"; text: string }[];
};

export default function OverviewPage() {
  const me = useStaff();
  const [o, setO] = useState<Overview | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [metric, setMetric] = useState<"sales" | "scans">("sales");

  const load = useCallback(async () => {
    const { data } = await supabase().rpc("admin_overview");
    if (data) { setO(data as Overview); setUpdated(new Date()); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    // Rafraîchissement immédiat à chaque vente / scan / rupture
    const sb = supabase();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(load, 800); };
    const ch = sb.channel("overview")
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_items" }, soon)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "occupancy_snapshots" }, soon)
      .subscribe();
    return () => { clearInterval(id); clearTimeout(t); sb.removeChannel(ch); };
  }, [load]);

  const nowH = new Date().getUTCHours();
  const occ = o?.occupancy;

  return (
    <>
      <PageTitle title={`Bonjour ${me?.full_name?.split(" ")[0] ?? ""}`} subtitle={`${dayLong(todayISO())} · en direct`}>
        <span className="flex items-center gap-2 text-xs font-semibold text-muted">
          <span className="relative flex size-2"><span className="absolute size-full animate-ping rounded-full bg-ok opacity-60" /><span className="relative size-2 rounded-full bg-ok" /></span>
          {updated ? `Mis à jour à ${time(updated.toISOString())}` : "Chargement…"}
        </span>
        <button onClick={load} className="grid size-9 place-items-center rounded-full border border-line bg-card" aria-label="Rafraîchir"><RefreshCw className="size-4" /></button>
      </PageTitle>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tone="dark" icon={Banknote} label="Chiffre d'affaires" value={o ? fcfa(o.revenue) : "…"} hint={o ? `Panier moyen ${fcfa(o.avg_basket)}` : undefined} />
        <Kpi tone="lime" icon={ShoppingBasket} label="Recharges encaissées" value={o ? fcfa(o.recharges) : "…"} hint={o ? `dont ${fcfa(o.recharges_cash)} en espèces` : undefined} />
        <Kpi icon={Ticket} label="Repas servis aujourd'hui" value={o ? String(o.served) : "…"} hint={o ? `${o.sold} tickets vendus · ${o.outstanding} en circulation` : undefined} />
        <Kpi icon={Users} label="Occupation" value={occ?.status === "open" ? `${Math.round(occ.rate)} %` : "Fermé"}
          hint={occ?.status === "open" ? `${occ.occupied_tables}/${occ.total_tables} tables · ~${occ.wait_min} min` : occ?.status === "closed" && occ.next ? `${SERVICE_LABEL[occ.next.service]} à ${time(occ.next.starts_at)}` : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title={metric === "sales" ? "Ventes par heure" : "Passages au comptoir par heure"} subtitle="Aujourd'hui · heure actuelle en vert"
          action={
            <div className="flex rounded-full bg-canvas p-0.5 text-xs font-bold">
              {([["sales", "Ventes"], ["scans", "Scans"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setMetric(k)} className={clsx("rounded-full px-3 py-1", metric === k ? "bg-ink text-white" : "text-muted")}>{l}</button>
              ))}
            </div>
          }>
          {o ? <Columns data={o.by_hour.map((b) => ({ label: `${b.h}h`, value: b[metric] }))} highlight={o.by_hour.findIndex((b) => b.h === nowH)}
            format={(n) => `${n} ${metric === "sales" ? "ventes" : "scans"}`} every={2} /> : <div className="h-44 animate-pulse rounded-xl bg-canvas" />}
        </Card>

        <Card title="Alertes" subtitle={o ? `${o.alerts.length} à traiter` : undefined}>
          <div className="space-y-2">
            {o?.alerts.length === 0 && <Empty>Tout va bien 👌</Empty>}
            {o?.alerts.map((a, i) => {
              const I = a.level === "err" ? CircleAlert : a.level === "warn" ? AlertTriangle : Info;
              return (
                <div key={i} className={clsx("flex items-start gap-2.5 rounded-xl p-3 text-sm font-semibold",
                  a.level === "err" ? "bg-err-soft text-err" : a.level === "warn" ? "bg-warn-soft text-[#92400e]" : "bg-canvas text-ink-2")}>
                  <I className="mt-0.5 size-4 shrink-0" /><span className="flex-1">{a.text}</span>
                  {a.kind === "menu" && <Link href="/admin/menu" className="underline">Ouvrir</Link>}
                  {a.kind === "stock" && <Link href="/admin/stock" className="underline">Stock</Link>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Services du jour" subtitle="Repas servis par rapport aux portions prévues">
          <div className="space-y-5">
            {o?.services.length === 0 && <Empty>Aucun service aujourd&apos;hui</Empty>}
            {o?.services.map((s) => (
              <div key={s.service}>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <p className="font-bold">{s.label}</p>
                  <p className="text-sm text-muted"><b className="text-ink">{s.served}</b> servis · {s.planned ?? "∞"} prévus</p>
                </div>
                <Meter value={s.served} max={s.planned || s.served || 1} tone="ok" />
                <p className="mt-1 text-xs text-muted">{s.outstanding} tickets {s.label.toLowerCase()} en circulation</p>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Top 5 des plats" subtitle="7 derniers jours">
          <ol className="space-y-3">
            {o?.top_dishes.map((d, i) => (
              <li key={d.name} className="flex items-center gap-3">
                <span className="w-4 text-sm font-extrabold text-muted">{i + 1}</span>
                <DishImage name={d.name} src={d.photo_url} className="size-10" rounded="rounded-xl" />
                <span className="flex-1 truncate text-sm font-bold">{d.name}</span>
                <Badge>{d.sold}</Badge>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Ruptures" subtitle="Plats épuisés aujourd'hui">
          <div className="flex items-center gap-4">
            <span className={clsx("grid size-16 place-items-center rounded-2xl text-2xl font-extrabold", (o?.sold_out ?? 0) > 0 ? "bg-err-soft text-err" : "bg-ok-soft text-[#15803d]")}>
              {o?.sold_out ?? "…"}
            </span>
            <p className="text-sm text-ink-2">Un plat déclaré épuisé disparaît de l&apos;appli client en moins de 3&nbsp;secondes.</p>
          </div>
          <Link href="/admin/menu" className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-canvas py-2.5 text-sm font-bold"><UtensilsCrossed className="size-4" />Gérer le menu du jour</Link>
          <Link href="/admin/previsions" className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-canvas py-2.5 text-sm font-bold"><Clock4 className="size-4" />Prévisions de production</Link>
        </Card>
      </div>
    </>
  );
}
