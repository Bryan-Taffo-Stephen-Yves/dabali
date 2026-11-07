"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Camera, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Card, PageTitle, Kpi, Badge } from "@/components/admin/ui";
import { AreaLine, Heatmap } from "@/components/admin/charts";
import { addDays, dayShort, dayNum, time, todayISO, SERVICE_LABEL } from "@/lib/format";
import type { Occupancy } from "@/lib/types";

type A = {
  room: { id: string; name: string; total_tables: number; layout: { id: string; x: number; y: number; seats: number }[] };
  now: Occupancy;
  last: { created_at: string; table_states: Record<string, boolean>; occupied_tables: number; rate: number; people_count: number; queue_count?: number | null; counter_count?: number | null } | null;
  curve: { t: string; rate: number; people: number }[];
  peaks: { dow: number; h: number; rate: number }[];
};
const DOW = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export default function OccupancyPage() {
  const [day, setDay] = useState(todayISO());
  const [a, setA] = useState<A | null>(null);
  const load = useCallback(() => supabase().rpc("admin_occupancy", { p_date: day }).then(({ data }) => setA(data as A)), [day]);

  useEffect(() => {
    load();
    const sb = supabase();
    const ch = sb.channel("occ-admin").on("postgres_changes", { event: "INSERT", schema: "public", table: "occupancy_snapshots" }, () => load()).subscribe();
    const id = setInterval(load, 15_000);
    return () => { sb.removeChannel(ch); clearInterval(id); };
  }, [load]);

  const live = a?.last && Date.now() - new Date(a.last.created_at).getTime() < 120_000;
  const states = live ? a!.last!.table_states : {};
  const pk = new Map(a?.peaks.map((p) => [`${p.dow}-${p.h}`, p.rate]));
  const now = a?.now;

  return (
    <>
      <PageTitle title="Affluence" subtitle={a?.room.name}>
        {live ? <Badge tone="ok"><Camera className="size-3.5" />Caméra en direct</Badge> : <Badge><Camera className="size-3.5" />Caméra hors ligne · estimation par les scans</Badge>}
      </PageTitle>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tone="dark" label="Taux d'occupation" value={now?.status === "open" ? `${Math.round(now.rate)} %` : "Fermé"} hint={now?.status === "open" ? SERVICE_LABEL[now.service] : undefined} />
        <Kpi label="Tables occupées" value={now?.status === "open" ? `${now.occupied_tables} / ${now.total_tables}` : "—"} />
        <Kpi label="Personnes détectées" value={live ? String(a!.last!.people_count) : "—"} hint={live ? `relevé à ${time(a!.last!.created_at)}` : undefined} />
        <Kpi tone="lime" label={now?.status === "open" && now.queue_count != null ? "File d'attente" : "Attente estimée"}
          value={now?.status === "open" ? (now.queue_count != null ? `${now.queue_count} pers. · ~${now.wait_min} min` : `~${now.wait_min} min`) : "—"}
          hint={now?.status === "open" ? (now.wait_source === "queue" ? "caméra (couloir) ÷ rythme du comptoir" : "estimation sans caméra de file") : undefined} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card title="Plan de salle" subtitle={live ? "Mis à jour toutes les 10 s par le module vision" : "En attente du module vision"}>
          <div className="grid grid-cols-5 gap-2.5">
            {a?.room.layout.map((t) => {
              const busy = states[t.id];
              return (
                <div key={t.id} className={clsx("flex aspect-square flex-col items-center justify-center rounded-2xl text-sm font-extrabold transition-colors",
                  !live ? "bg-canvas text-off" : busy ? "bg-err text-white" : "bg-ok-soft text-[#15803d]")}>
                  {t.id}<span className="text-[10px] font-semibold opacity-80">{!live ? "—" : busy ? "occupée" : "libre"}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-4 flex items-center gap-2 text-xs text-muted"><ShieldCheck className="size-4 shrink-0" />Analyse locale, sans reconnaissance faciale : seuls des chiffres sont transmis, aucune image n&apos;est conservée.</p>
        </Card>

        <Card title="Occupation de la journée" subtitle="Taux d'occupation (%)"
          action={
            <div className="flex gap-1">
              {Array.from({ length: 6 }, (_, i) => addDays(todayISO(), -i)).map((d) => (
                <button key={d} onClick={() => setDay(d)} className={clsx("h-8 rounded-full px-2.5 text-xs font-bold", d === day ? "bg-ink text-white" : "bg-canvas")}>
                  {i0(d)}
                </button>
              ))}
            </div>
          }>
          {a && <AreaLine data={a.curve.map((c) => ({ x: new Date(c.t).getTime(), label: time(c.t), value: Number(c.rate) }))} max={100}
            format={(n) => `${Math.round(n)} %`} xLabel={(x) => time(new Date(x).toISOString())} />}
        </Card>
      </div>

      <Card className="mt-4" title="Heures de pointe par jour de semaine" subtitle="Occupation moyenne sur 4 semaines">
        {a && <Heatmap rows={[1, 2, 3, 4, 5, 6]} cols={[11, 12, 13, 14, 18, 19, 20]} value={(r, c) => pk.get(`${r}-${c}`)}
          rowLabel={(r) => DOW[r]} colLabel={(c) => `${c}h`} format={(n) => `${n} %`} />}
      </Card>
    </>
  );
}

function i0(d: string) {
  return d === todayISO() ? "Auj." : `${dayShort(d)} ${dayNum(d)}`;
}
