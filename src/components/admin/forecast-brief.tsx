"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { Sparkles, RefreshCw, ShoppingCart, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { time } from "@/lib/format";

type Brief = {
  titre: string; resume: string;
  actions: { priorite: "haute" | "moyenne" | "basse"; titre: string; detail: string }[];
  achats: string; vigilance: string[];
};

const PRIO = { haute: "bg-err-soft text-err", moyenne: "bg-warn-soft text-[#92400e]", basse: "bg-canvas text-muted" };

/** Brief IA du chef : Claude lit les prévisions du jour et l'historique de gaspillage. */
export function ForecastBrief({ date }: { date: string }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setBrief(null); setAt(null); setErr(null);
    supabase().from("ai_forecast_briefs").select("brief, created_at").eq("service_date", date).maybeSingle()
      .then(({ data }) => { if (data) { setBrief(data.brief as Brief); setAt(data.created_at); } });
  }, [date]);

  async function run(refresh: boolean) {
    setBusy(true); setErr(null);
    const { data, error } = await supabase().functions.invoke("forecast-assistant", { body: { date, refresh } });
    setBusy(false);
    if (error || !data?.ok) {
      let msg = data?.message as string | undefined;
      if (!msg && error && "context" in error) msg = (await (error as { context: Response }).context.json().catch(() => null))?.message;
      return setErr(msg ?? "L'assistant est indisponible.");
    }
    setBrief(data.brief); setAt(data.created_at);
  }

  return (
    <div className="mb-4 overflow-hidden rounded-[22px] bg-ink text-white">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <span className="grid size-10 place-items-center rounded-xl bg-lime text-ink"><Sparkles className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-lime">Assistant IA · brief du chef</p>
          <p className="truncate font-extrabold">{brief ? brief.titre : busy ? "Analyse des prévisions…" : "Que préparer et quoi acheter ? Demandez à l'assistant."}</p>
        </div>
        {brief ? (
          <button onClick={() => run(true)} disabled={busy} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/20 disabled:opacity-50">
            <RefreshCw className={clsx("size-3.5", busy && "animate-spin")} />{at ? `Généré à ${time(at)}` : "Actualiser"}
          </button>
        ) : (
          <Button size="sm" loading={busy} onClick={() => run(false)}><Sparkles className="size-4" />Analyser</Button>
        )}
      </div>
      {err && <p className="px-5 pb-4 text-sm font-semibold text-[#fca5a5]">{err}</p>}
      {busy && !brief && <div className="mx-5 mb-5 h-24 animate-pulse rounded-xl bg-white/10" />}
      {brief && (
        <div className="grid gap-4 border-t border-white/10 px-5 py-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div>
            <p className="mb-3 text-sm leading-relaxed text-white/80">{brief.resume}</p>
            <ol className="space-y-2">
              {brief.actions.map((a, i) => (
                <li key={i} className="rounded-xl bg-white p-3 text-ink">
                  <p className="flex items-center gap-2 text-sm font-extrabold">
                    <span className={clsx("rounded-full px-2 py-0.5 text-[10px] uppercase", PRIO[a.priorite])}>{a.priorite}</span>{a.titre}
                  </p>
                  <p className="mt-1 text-[13px] text-ink-2">{a.detail}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl bg-lime p-3 text-ink">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider"><ShoppingCart className="size-3.5" />Courses</p>
              <p className="text-sm font-semibold">{brief.achats}</p>
            </div>
            {brief.vigilance.length > 0 && (
              <div className="rounded-xl bg-white/10 p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-lime"><AlertTriangle className="size-3.5" />À surveiller</p>
                <ul className="space-y-1.5 text-[13px] text-white/85">{brief.vigilance.map((v, i) => <li key={i}>• {v}</li>)}</ul>
              </div>
            )}
            <p className="text-[11px] text-white/50">Généré par Claude à partir des prévisions et du gaspillage des 4 mêmes jours passés. À valider par le chef.</p>
          </div>
        </div>
      )}
    </div>
  );
}
