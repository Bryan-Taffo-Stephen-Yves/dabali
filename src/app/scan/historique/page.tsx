"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, UtensilsCrossed } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { ServiceIcon } from "@/components/app/service-icon";
import { PushToggle } from "@/components/push-toggle";
import { addDays, time, todayISO, SERVICE_LABEL } from "@/lib/format";
import { SERVICES, type Extra, type ServiceKind } from "@/lib/types";

type Row = {
  id: string; service: ServiceKind; used_at: string; scanned_by: string; extras: Extra[]; gift_from: string | null; is_reward: boolean;
  client: { full_name: string; short_code: string | null } | null;
  agent: { full_name: string } | null;
  dish: { name: string } | null;
};

const COLS = "id, service, used_at, scanned_by, extras, gift_from, is_reward, client:profiles!tickets_user_id_fkey(full_name, short_code), agent:profiles!tickets_scanned_by_fkey(full_name), dish:dishes(name)";

/** Historique des tickets scannés au comptoir (agent) : par jour, par service, les miens ou toute l'équipe. */
export default function ScanHistory() {
  const [me, setMe] = useState<string | null>(null);
  const [day, setDay] = useState(todayISO());
  const [who, setWho] = useState<"me" | "all">("me");
  const [svc, setSvc] = useState<ServiceKind | "all">("all");
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    const sb = supabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    setMe(user.id);
    // Journée en heure d'Abidjan (UTC+0)
    const { data } = await sb.from("tickets").select(COLS).eq("status", "used")
      .gte("used_at", `${day}T00:00:00Z`).lt("used_at", `${addDays(day, 1)}T00:00:00Z`)
      .order("used_at", { ascending: false }).limit(500);
    setRows((data ?? []) as unknown as Row[]);
  }, [day]);

  useEffect(() => {
    setRows(null);
    load();
    const sb = supabase();
    const ch = sb.channel("scan-history").on("postgres_changes", { event: "UPDATE", schema: "public", table: "tickets" }, () => load()).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [load]);

  const mine = useMemo(() => (rows ?? []).filter((r) => who === "all" || r.scanned_by === me), [rows, who, me]);
  const list = mine.filter((r) => svc === "all" || r.service === svc);
  const bySvc = SERVICES.map((s) => ({ s, n: mine.filter((r) => r.service === s).length })).filter((x) => x.n > 0);
  const withExtras = list.filter((r) => r.extras?.length).length;

  return (
    <main className="min-h-dvh bg-ink pb-10 text-white">
      <header className="sticky top-0 z-10 bg-ink px-4 pb-3 pt-[max(0.8rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <Link href="/scan" aria-label="Retour au scanner" className="grid size-10 place-items-center rounded-full bg-white/10"><ArrowLeft className="size-4" /></Link>
          <div className="flex-1">
            <p className="text-lg font-extrabold leading-tight">Tickets scannés</p>
            <p className="text-xs text-white/60">{rows === null ? "Chargement…" : `${list.length} ticket${list.length > 1 ? "s" : ""} · ${withExtras} avec supplément`}</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          {[[todayISO(), "Aujourd'hui"], [addDays(todayISO(), -1), "Hier"]].map(([d, l]) => (
            <button key={d} onClick={() => setDay(d)} className={clsx("h-9 rounded-full px-4 text-sm font-bold", day === d ? "bg-lime text-ink" : "bg-white/10")}>{l}</button>
          ))}
          <span className="ml-auto flex rounded-full bg-white/10 p-0.5 text-xs font-bold">
            {([["me", "Moi"], ["all", "Équipe"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setWho(k)} className={clsx("rounded-full px-3", who === k ? "bg-white text-ink" : "text-white/70")}>{l}</button>
            ))}
          </span>
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          <button onClick={() => setSvc("all")} className={clsx("h-8 shrink-0 rounded-full px-3 text-xs font-bold", svc === "all" ? "bg-white text-ink" : "bg-white/10")}>Tous · {mine.length}</button>
          {bySvc.map(({ s, n }) => (
            <button key={s} onClick={() => setSvc(s)} className={clsx("flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold", svc === s ? "bg-white text-ink" : "bg-white/10")}>
              <ServiceIcon service={s} className="size-3.5" />{SERVICE_LABEL[s]} · {n}
            </button>
          ))}
        </div>
      </header>

      <div className="space-y-2 px-4">
        <PushToggle dark />
        {rows === null && <div className="h-40 animate-pulse rounded-2xl bg-white/5" />}
        {rows && list.length === 0 && <p className="py-16 text-center text-sm text-white/50">Aucun ticket scanné {day === todayISO() ? "aujourd'hui" : "ce jour-là"}.</p>}
        {list.map((r) => (
          <div key={r.id} className="flex items-start gap-3 rounded-2xl bg-white/5 p-3">
            <span className="w-12 shrink-0 pt-0.5 text-center"><span className="block text-sm font-extrabold text-lime">{time(r.used_at)}</span><span className="block text-[10px] font-semibold text-white/50">{new Date(r.used_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "Africa/Abidjan" })}</span></span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{r.client?.full_name ?? "Client"}<span className="ml-1.5 text-xs font-semibold text-white/50">{r.client?.short_code}</span></p>
              <p className="flex items-center gap-1.5 text-[13px] text-white/70">
                <ServiceIcon service={r.service} className="size-3.5" />{SERVICE_LABEL[r.service]}
                <span className="text-white/30">·</span>
                {r.dish ? <><UtensilsCrossed className="size-3.5" />{r.dish.name}</> : <span className="italic text-white/50">plat non précisé</span>}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {r.extras?.length > 0
                  ? r.extras.map((e) => <span key={e.id} className="rounded-full bg-lime px-2 py-0.5 text-[11px] font-bold text-ink">+ {e.name}</span>)
                  : <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/60">sans supplément</span>}
                {r.gift_from && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold">🎁 {r.gift_from}</span>}
                {r.is_reward && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold">⭐ fidélité</span>}
                {who === "all" && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/60">par {r.agent?.full_name ?? "?"}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
