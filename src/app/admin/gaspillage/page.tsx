"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { supabase } from "@/lib/supabase/client";
import { Card, PageTitle, Kpi, Segmented, input } from "@/components/admin/ui";
import { Columns, Meter } from "@/components/admin/charts";
import { useToast } from "@/components/ui/toast";
import { addDays, dayNum, dayShort, fcfa, todayISO, SERVICE_LABEL } from "@/lib/format";

type W = {
  prepared: number; served: number; lost: number; cost: number;
  daily: { day: string; prepared: number; served: number; lost: number; cost: number }[];
  dishes: { name: string; lost: number; cost: number; rate: number | null }[];
};
type Row = { id: string; service: "lunch" | "dinner"; prepared_qty: number | null; served_qty: number; sold_qty: number; dish: { name: string } };

export default function WastePage() {
  const toast = useToast();
  const [period, setPeriod] = useState<"7" | "28">("28");
  const [w, setW] = useState<W | null>(null);
  const [day, setDay] = useState(todayISO());
  const [rows, setRows] = useState<Row[]>([]);
  const to = todayISO(), from = addDays(to, -(+period - 1));

  const load = useCallback(() => {
    supabase().rpc("admin_waste", { p_from: from, p_to: to }).then(({ data }) => setW(data as W));
  }, [from, to]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    supabase().from("menu_items").select("id, service, prepared_qty, served_qty, sold_qty, dish:dishes(name)").eq("service_date", day).order("service")
      .then(({ data }) => setRows((data ?? []) as unknown as Row[]));
  }, [day]);

  async function setPrepared(id: string, v: number | null) {
    const { error } = await supabase().from("menu_items").update({ prepared_qty: v }).eq("id", id);
    if (error) return toast("err", "Enregistrement refusé.");
    setRows((l) => l.map((r) => (r.id === id ? { ...r, prepared_qty: v } : r)));
    load();
  }

  const rate = w && w.prepared ? Math.round((w.lost / w.prepared) * 1000) / 10 : 0;
  const maxLost = Math.max(...(w?.dishes.map((d) => d.lost) ?? [1]), 1);

  return (
    <>
      <PageTitle title="Gaspillage" subtitle="Préparées − servies = portions perdues">
        <Segmented value={period} onChange={setPeriod} options={[["7", "7 jours"], ["28", "4 semaines"]]} />
      </PageTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tone="dark" label="Portions perdues" value={w ? String(w.lost) : "…"} hint={`${rate} % de la production`} />
        <Kpi label="Coût estimé" value={w ? fcfa(w.cost) : "…"} hint="selon les recettes et le coût des ingrédients" />
        <Kpi label="Préparées" value={w ? String(w.prepared) : "…"} />
        <Kpi tone="lime" label="Servies" value={w ? String(w.served) : "…"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card title="Portions perdues par jour" subtitle="L'objectif : une courbe qui descend grâce aux précommandes">
          {w ? <Columns data={w.daily.map((d) => ({ label: d.day, value: d.lost }))} format={(n) => `${n} portions`}
            label={(l) => `${dayNum(l)}/${l.slice(5, 7)}`} every={period === "28" ? 3 : 1} /> : <div className="h-44 animate-pulse rounded-xl bg-canvas" />}
        </Card>
        <Card title="Par plat">
          <div className="space-y-3">
            {w?.dishes.map((d) => (
              <div key={d.name}>
                <div className="mb-1 flex text-sm"><span className="flex-1 truncate font-bold">{d.name}</span><span className="text-muted">{d.lost} · {d.rate ?? 0} % · {fcfa(d.cost)}</span></div>
                <Meter value={d.lost} max={maxLost} tone={(d.rate ?? 0) > 15 ? "err" : (d.rate ?? 0) > 8 ? "warn" : "ink"} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4" title="Saisie des portions préparées" subtitle="À remplir par le chef après chaque service">
        <div className="mb-4 flex gap-1.5 overflow-x-auto">
          {Array.from({ length: 7 }, (_, i) => addDays(to, -i)).map((d) => (
            <button key={d} onClick={() => setDay(d)} className={clsx("h-9 shrink-0 rounded-full px-3 text-sm font-bold", d === day ? "bg-ink text-white" : "bg-canvas")}>
              {d === to ? "Aujourd'hui" : `${dayShort(d)} ${dayNum(d)}`}
            </button>
          ))}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {rows.map((r) => {
            const lost = r.prepared_qty != null ? Math.max(r.prepared_qty - r.served_qty, 0) : null;
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{r.dish.name}</p>
                  <p className="text-xs text-muted">{SERVICE_LABEL[r.service]} · {r.sold_qty} vendus · {r.served_qty} servis</p>
                </div>
                <input type="number" min={0} defaultValue={r.prepared_qty ?? ""} key={`${r.id}-${r.prepared_qty}`} placeholder="Prép."
                  onBlur={(e) => { const v = e.target.value === "" ? null : +e.target.value; if (v !== r.prepared_qty) setPrepared(r.id, v); }}
                  className={clsx(input, "h-9 w-20 text-right font-bold")} />
                <span className={clsx("w-16 text-right text-sm font-extrabold", lost ? "text-err" : "text-muted")}>{lost == null ? "—" : `−${lost}`}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
