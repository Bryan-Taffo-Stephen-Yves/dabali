"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Download, ScanLine, Search } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Card, Kpi, PageTitle, Badge, Empty, downloadCsv, input } from "@/components/admin/ui";
import { ServiceBadge } from "@/components/app/service-icon";
import { addDays, dayLong, fcfa, time, todayISO, SERVICE_LABEL } from "@/lib/format";
import { SERVICES, type Extra, type ServiceKind } from "@/lib/types";

type Row = {
  id: string; service: ServiceKind; used_at: string; scanned_by: string | null; total: number; extras: Extra[];
  gift_from: string | null; is_reward: boolean;
  client: { full_name: string; short_code: string | null } | null;
  agent: { full_name: string } | null;
  dish: { name: string } | null;
};

const COLS = "id, service, used_at, scanned_by, total, extras, gift_from, is_reward, client:profiles!tickets_user_id_fkey(full_name, short_code), agent:profiles!tickets_scanned_by_fkey(full_name), dish:dishes(name)";

/** Historique des scans au comptoir : par jour, service, agent ; valeur encaissée ; export CSV. */
export default function ScansAdmin() {
  const [day, setDay] = useState(todayISO());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [svc, setSvc] = useState<ServiceKind | "all">("all");
  const [agent, setAgent] = useState("all");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase().from("tickets").select(COLS).eq("status", "used")
      .gte("used_at", `${day}T00:00:00Z`).lt("used_at", `${addDays(day, 1)}T00:00:00Z`)
      .order("used_at", { ascending: false }).limit(2000);
    setRows((data ?? []) as unknown as Row[]);
  }, [day]);

  useEffect(() => {
    setRows(null);
    load();
    const sb = supabase();
    let t: ReturnType<typeof setTimeout> | undefined;
    const ch = sb.channel("admin-scans").on("postgres_changes", { event: "UPDATE", schema: "public", table: "tickets" },
      () => { clearTimeout(t); t = setTimeout(load, 800); }).subscribe();
    return () => { clearTimeout(t); sb.removeChannel(ch); };
  }, [load]);

  const agents = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const r of rows ?? []) {
      const k = r.scanned_by ?? "?";
      m.set(k, { name: r.agent?.full_name ?? "?", n: (m.get(k)?.n ?? 0) + 1 });
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [rows]);

  const needle = q.trim().toLowerCase();
  const list = (rows ?? []).filter((r) => (svc === "all" || r.service === svc) && (agent === "all" || r.scanned_by === agent)
    && (!needle || `${r.client?.full_name} ${r.client?.short_code} ${r.dish?.name}`.toLowerCase().includes(needle)));
  const value = list.reduce((s, r) => s + r.total, 0);
  const withExtras = list.filter((r) => r.extras?.length).length;
  const noDish = list.filter((r) => !r.dish).length;

  return (
    <>
      <PageTitle title="Scans au comptoir" subtitle={`${dayLong(day)} · mis à jour en direct`}>
        <input type="date" value={day} max={todayISO()} onChange={(e) => e.target.value && setDay(e.target.value)} className={input} />
        <button onClick={() => downloadCsv(`scans-${day}.csv`, [
          ["Heure", "Client", "Identifiant", "Service", "Plat servi", "Supplément", "Montant (FCFA)", "Agent", "Offert par", "Fidélité"],
          ...list.map((r) => [time(r.used_at), r.client?.full_name ?? "", r.client?.short_code ?? "", SERVICE_LABEL[r.service], r.dish?.name ?? "",
            (r.extras ?? []).map((e) => e.name).join(" + "), r.total, r.agent?.full_name ?? "", r.gift_from ?? "", r.is_reward ? "oui" : ""]),
        ])} className="flex h-10 items-center gap-1.5 rounded-full border border-line bg-card px-4 text-sm font-bold"><Download className="size-4" />CSV</button>
      </PageTitle>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tone="dark" icon={ScanLine} label="Tickets scannés" value={rows ? String(list.length) : "…"} hint={rows && list.length !== rows.length ? `sur ${rows.length} ce jour-là` : undefined} />
        <Kpi tone="lime" label="Encaissé · repas servis" value={rows ? fcfa(value) : "…"} hint="valeur des tickets scannés" />
        <Kpi label="Avec supplément" value={rows ? String(withExtras) : "…"} hint={rows && list.length ? `${Math.round((withExtras / list.length) * 100)} % des repas` : undefined} />
        <Kpi label="Plat non précisé" value={rows ? String(noDish) : "…"} hint="scan validé sans choix du plat" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Card pad={false}
          title={`${list.length} scan${list.length > 1 ? "s" : ""}`}
          action={
            <span className="mr-5 flex items-center gap-2">
              <Search className="size-4 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Client, identifiant, plat…" className={clsx(input, "h-9 w-48")} />
            </span>
          }>
          <div className="flex flex-wrap gap-1.5 border-b border-line px-5 pb-3">
            <button onClick={() => setSvc("all")} className={clsx("h-8 rounded-full px-3 text-xs font-bold", svc === "all" ? "bg-ink text-white" : "bg-canvas")}>Tous</button>
            {SERVICES.map((s) => {
              const n = (rows ?? []).filter((r) => r.service === s).length;
              return n ? <button key={s} onClick={() => setSvc(s)} className={clsx("h-8 rounded-full px-3 text-xs font-bold", svc === s ? "bg-ink text-white" : "bg-canvas")}>{SERVICE_LABEL[s]} · {n}</button> : null;
            })}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line bg-canvas text-left text-xs font-bold uppercase tracking-wider text-muted">
                <th className="px-5 py-2.5">Heure</th><th className="px-2">Client</th><th className="px-2">Repas</th><th className="px-2">Supplément</th>
                <th className="px-2 text-right">Montant</th><th className="px-5">Agent</th></tr></thead>
              <tbody>
                {rows === null && <tr><td colSpan={6} className="p-5"><div className="h-32 animate-pulse rounded-xl bg-canvas" /></td></tr>}
                {rows && list.length === 0 && <tr><td colSpan={6} className="p-5"><Empty>Aucun ticket scanné</Empty></td></tr>}
                {list.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-2.5 font-extrabold">{time(r.used_at)}</td>
                    <td className="px-2">
                      <p className="font-bold">{r.client?.full_name ?? "—"}</p>
                      <p className="text-xs text-muted">{r.client?.short_code}{r.gift_from ? ` · 🎁 ${r.gift_from}` : ""}{r.is_reward ? " · ⭐ fidélité" : ""}</p>
                    </td>
                    <td className="px-2">
                      <span className="flex items-center gap-2">
                        <ServiceBadge service={r.service} size="size-7" />
                        <span>{r.dish?.name ?? <span className="italic text-muted">non précisé</span>}</span>
                      </span>
                    </td>
                    <td className="px-2">{r.extras?.length ? r.extras.map((e) => <Badge key={e.id} tone="lime">+ {e.name}</Badge>) : <span className="text-xs text-muted">—</span>}</td>
                    <td className="px-2 text-right font-semibold">{r.total ? fcfa(r.total) : "offert"}</td>
                    <td className="px-5 text-muted">{r.agent?.full_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Par agent" subtitle="Cliquez pour filtrer">
          <div className="space-y-1.5">
            <button onClick={() => setAgent("all")} className={clsx("flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-bold", agent === "all" ? "bg-ink text-white" : "bg-canvas")}>
              Toute l&apos;équipe<span>{rows?.length ?? "…"}</span>
            </button>
            {agents.map(([id, a]) => (
              <button key={id} onClick={() => setAgent(id)} className={clsx("flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-bold", agent === id ? "bg-ink text-white" : "bg-canvas")}>
                <span className="truncate">{a.name}</span><span>{a.n}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
