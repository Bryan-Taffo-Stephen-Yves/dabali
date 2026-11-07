"use client";
import { useEffect, useState } from "react";
import { Download, Star } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Card, PageTitle, Kpi, Segmented, downloadCsv } from "@/components/admin/ui";
import { Columns, Heatmap, Meter } from "@/components/admin/charts";
import { addDays, dayNum, fcfa, todayISO } from "@/lib/format";

type S = {
  revenue: number; sales: number; held: number; refunded_expired: number;
  recharges: number; transfers: number; tickets: number; served: number; expired: number; cancelled: number;
  daily: { day: string; revenue: number; tickets: number }[];
  dishes: { name: string; sold: number; revenue: number; stars: number | null }[];
  heatmap: { dow: number; h: number; n: number }[];
};
const DOW = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export default function SalesPage() {
  const [period, setPeriod] = useState<"7" | "14" | "28">("7");
  const [s, setS] = useState<S | null>(null);
  const to = todayISO(), from = addDays(to, -(+period - 1));

  useEffect(() => {
    setS(null);
    supabase().rpc("admin_sales", { p_from: from, p_to: to }).then(({ data }) => setS(data as S));
  }, [from, to]);

  const maxSold = Math.max(...(s?.dishes.map((d) => d.sold) ?? [1]));
  const expiryRate = s && s.tickets ? Math.round((s.expired / s.tickets) * 1000) / 10 : 0;
  const hm = new Map(s?.heatmap.map((c) => [`${c.dow}-${c.h}`, c.n]));

  return (
    <>
      <PageTitle title="Ventes et rapports" subtitle={`Du ${dayNum(from)}/${from.slice(5, 7)} au ${dayNum(to)}/${to.slice(5, 7)}`}>
        <Segmented value={period} onChange={setPeriod} options={[["7", "7 jours"], ["14", "14 jours"], ["28", "4 semaines"]]} />
        <button disabled={!s} onClick={() => s && downloadCsv(`ventes-${from}-${to}.csv`, [
          ["Jour", "Encaissé - repas servis (FCFA)", "Tickets servis"], ...s.daily.map((d) => [d.day, d.revenue, d.tickets]), [],
          ["Plat", "Vendus", "CA (FCFA)", "Note"], ...s.dishes.map((d) => [d.name, d.sold, d.revenue, d.stars]),
        ])} className="flex h-10 items-center gap-1.5 rounded-full border border-line bg-card px-4 text-sm font-bold"><Download className="size-4" />Export CSV</button>
      </PageTitle>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tone="dark" label="Encaissé · repas servis" value={s ? fcfa(s.revenue) : "…"} hint={s ? `tickets scannés · ${fcfa(Math.round(s.revenue / +period))} / jour` : undefined} />
        <Kpi tone="lime" label="Recharges" value={s ? fcfa(s.recharges) : "…"} hint={s ? `Transferts entre clients : ${fcfa(s.transfers)}` : undefined} />
        <Kpi label="Tickets" value={s ? String(s.tickets) : "…"} hint={s ? `${s.served} servis · ${s.cancelled} annulés` : undefined} />
        <Kpi label="En attente" value={s ? fcfa(s.held) : "…"} hint={s ? `tickets valides pas encore scannés · ${expiryRate} % expirent (${fcfa(s.refunded_expired)} remboursés)` : undefined} />
      </div>

      <Card className="mt-4" title="Encaissé par jour" subtitle="Valeur des tickets scannés au comptoir : l'argent ne revient au prestataire qu'au scan">
        {s ? <Columns data={s.daily.map((d) => ({ label: d.day, value: d.revenue }))} format={fcfa} label={(l) => `${dayNum(l)}/${l.slice(5, 7)}`}
          every={+period > 14 ? 3 : 1} highlight={s.daily.length - 1} /> : <div className="h-44 animate-pulse rounded-xl bg-canvas" />}
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Plats les plus et les moins vendus">
          <div className="space-y-3">
            {s?.dishes.map((d, i) => (
              <div key={d.name}>
                <div className="mb-1 flex items-center gap-2 text-sm">
                  <span className="w-5 font-extrabold text-muted">{i + 1}</span>
                  <span className="flex-1 truncate font-bold">{d.name}</span>
                  {d.stars && <span className="flex items-center gap-0.5 text-xs font-bold text-muted"><Star className="size-3 fill-warn text-warn" />{d.stars}</span>}
                  <span className="w-12 text-right font-extrabold">{d.sold}</span>
                  <span className="w-28 text-right text-muted">{fcfa(d.revenue)}</span>
                </div>
                <div className="pl-7"><Meter value={d.sold} max={maxSold} tone={i === s.dishes.length - 1 ? "warn" : "ink"} /></div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Heures de pointe" subtitle="Passages au comptoir par jour et par heure">
          {s && <Heatmap rows={[1, 2, 3, 4, 5, 6]} cols={[11, 12, 13, 14, 18, 19, 20]} value={(r, c) => hm.get(`${r}-${c}`)}
            rowLabel={(r) => DOW[r]} colLabel={(c) => `${c}h`} format={(n) => `${n}`} />}
        </Card>
      </div>
    </>
  );
}
