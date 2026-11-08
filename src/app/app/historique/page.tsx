"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowDownLeft, ArrowUpRight, Banknote, Gift, RotateCcw, Smartphone, UtensilsCrossed } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/app/page-header";
import { fcfa, signedFcfa, relativeDay, time, todayISO } from "@/lib/format";

type Tx = { id: string; type: string; amount: number; balance_after: number; note: string | null; created_at: string; counterpart_name: string | null };

const META: Record<string, { label: string; icon: typeof Gift; bg: string }> = {
  recharge: { label: "Recharge Mobile Money", icon: Smartphone, bg: "bg-lime-soft text-lime-deep" },
  recharge_cash: { label: "Recharge en caisse", icon: Banknote, bg: "bg-lime-soft text-lime-deep" },
  purchase: { label: "Achat de ticket", icon: UtensilsCrossed, bg: "bg-canvas text-ink" },
  transfer_in: { label: "Transfert reçu", icon: ArrowDownLeft, bg: "bg-ok-soft text-[#15803d]" },
  transfer_out: { label: "Transfert envoyé", icon: ArrowUpRight, bg: "bg-canvas text-ink" },
  refund: { label: "Remboursement", icon: RotateCcw, bg: "bg-ok-soft text-[#15803d]" },
  bonus: { label: "Bonus", icon: Gift, bg: "bg-lime-soft text-lime-deep" },
};

const FILTERS = [
  { id: "all", label: "Tout" },
  { id: "in", label: "Entrées" },
  { id: "out", label: "Dépenses" },
];

export default function HistoryPage() {
  const [txs, setTxs] = useState<Tx[] | null>(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    (async () => {
      const sb = supabase();
      const { data: { user } } = await sb.auth.getUser();
      const { data } = await sb.from("transactions").select("id, type, amount, balance_after, note, created_at, counterpart_name")
        .eq("user_id", user!.id).order("created_at", { ascending: false }).limit(150);
      setTxs(data ?? []);
    })();
  }, []);

  const list = (txs ?? []).filter((t) => filter === "all" || (filter === "in" ? t.amount > 0 : t.amount < 0));
  const groups = list.reduce<Record<string, Tx[]>>((g, t) => {
    const d = todayISO(new Date(t.created_at));
    (g[d] ??= []).push(t);
    return g;
  }, {});
  const month = (txs ?? []).filter((t) => t.created_at.slice(0, 7) === todayISO().slice(0, 7));
  const spent = -month.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);

  return (
    <main>
      <PageHeader title="Historique" back={false} />
      <div className="px-4">
        <div className="rounded-[24px] bg-ink p-5 text-white">
          <p className="text-sm font-bold text-white/60">Dépensé ce mois-ci</p>
          <p className="mt-1 text-3xl font-extrabold">{fcfa(spent)}</p>
          <p className="mt-1 text-sm text-lime">{month.filter((t) => t.type === "purchase").length} repas réservés</p>
        </div>

        <div className="mt-4 flex gap-2">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={clsx("h-9 rounded-full px-4 text-sm font-bold", filter === f.id ? "bg-ink text-white" : "bg-card text-ink-2 shadow-[var(--shadow-card)]")}>
              {f.label}
            </button>
          ))}
        </div>

        {txs === null && <div className="mt-4 h-64 animate-pulse rounded-[24px] bg-card" />}
        {Object.entries(groups).map(([day, items]) => (
          <section key={day} className="mt-5">
            <h2 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-muted">{relativeDay(day)}</h2>
            <div className="divide-y divide-line overflow-hidden rounded-[22px] bg-card shadow-[var(--shadow-card)]">
              {items.map((t) => {
                const m = META[t.type] ?? META.bonus;
                const I = m.icon;
                return (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={clsx("grid size-10 shrink-0 place-items-center rounded-xl", m.bg)}><I className="size-[18px]" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">
                        {t.type === "purchase" && t.note ? t.note
                          : t.counterpart_name && t.type === "transfer_in" ? `Reçu de ${t.counterpart_name}`
                          : t.counterpart_name && t.type === "transfer_out" ? `Envoyé à ${t.counterpart_name}`
                          : m.label}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {[t.type === "purchase" || t.counterpart_name ? m.label : null, t.type !== "purchase" ? t.note : null, time(t.created_at)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={clsx("text-sm font-extrabold", t.amount > 0 ? "text-[#15803d]" : "text-ink")}>{signedFcfa(t.amount)}</p>
                      <p className="text-[11px] text-off">Solde {fcfa(t.balance_after)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
