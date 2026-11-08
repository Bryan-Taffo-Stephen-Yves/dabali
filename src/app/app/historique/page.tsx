"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowDownLeft, ArrowUpRight, Banknote, ChevronDown, Gift, RotateCcw, Smartphone, UtensilsCrossed } from "lucide-react";
import { myId, supabase } from "@/lib/supabase/client";
import { readCache, writeCache } from "@/lib/offline";
import { PageHeader } from "@/components/app/page-header";
import { fcfa, signedFcfa, relativeDay, time, todayISO } from "@/lib/format";

type Tx = { id: string; type: string; amount: number; balance_after: number; note: string | null; created_at: string; counterpart_name: string | null };

// Une couleur par famille : vert = argent qui entre, bleu = transferts envoyés, gris = repas achetés
const META: Record<string, { label: string; icon: typeof Gift; bg: string }> = {
  recharge: { label: "Recharge Mobile Money", icon: Smartphone, bg: "bg-lime-soft text-lime-deep" },
  recharge_cash: { label: "Recharge en caisse", icon: Banknote, bg: "bg-lime-soft text-lime-deep" },
  purchase: { label: "Achat de ticket", icon: UtensilsCrossed, bg: "bg-canvas text-ink" },
  transfer_in: { label: "Transfert reçu", icon: ArrowDownLeft, bg: "bg-ok-soft text-[#15803d]" },
  transfer_out: { label: "Transfert envoyé", icon: ArrowUpRight, bg: "bg-[#e0ebff] text-[#1d4ed8]" },
  refund: { label: "Remboursement", icon: RotateCcw, bg: "bg-ok-soft text-[#15803d]" },
  bonus: { label: "Bonus", icon: Gift, bg: "bg-lime-soft text-lime-deep" },
};

const who = (t: Tx) => t.counterpart_name?.split(" · ")[0] ?? "";
const code = (t: Tx) => t.counterpart_name?.split(" · ")[1] ?? null;

/** Titre court et toujours du même style */
function title(t: Tx) {
  if (t.type === "purchase") {
    const what = t.note ? (/^\d+\s*×/.test(t.note) ? t.note.replace(/^(\d+)\s*×\s*ticket/i, "$1 × ticket") : `Ticket · ${t.note}`) : "Achat de ticket";
    return what.charAt(0).toUpperCase() + what.slice(1);
  }
  if (t.type === "transfer_in" && t.counterpart_name) return `Reçu de ${who(t)}`;
  if (t.type === "transfer_out" && t.counterpart_name) return `Envoyé à ${who(t)}`;
  if (t.type === "refund") return t.note?.includes(" · ") ? `Remboursé · ${t.note.split(" · ").slice(1).join(" · ")}` : "Remboursement";
  return META[t.type]?.label ?? "Opération";
}

/** Ligne du dessous : l'heure d'abord, puis l'utile (code, bénéficiaire, message) */
function detail(t: Tx) {
  const parts = [time(t.created_at)];
  if (t.type === "purchase" && t.counterpart_name) parts.push(`offert à ${who(t)}`);
  if (t.type.startsWith("transfer") && code(t)) parts.push(code(t)!);
  if (t.type.startsWith("transfer") && t.note) parts.push(`« ${t.note} »`);
  if (t.type === "recharge" && t.note?.toLowerCase().includes("simulation")) parts.push("simulation");
  return parts.join(" · ");
}

/** Transferts répétés vers / depuis la même personne le même jour : regroupés en une ligne */
type Row = { key: string; items: Tx[] };
function rows(items: Tx[]): Row[] {
  const out: Row[] = [];
  for (const t of items) {
    const last = out[out.length - 1];
    const groupable = t.type.startsWith("transfer") && t.counterpart_name;
    if (groupable && last && last.items[0].type === t.type && last.items[0].counterpart_name === t.counterpart_name) last.items.push(t);
    else out.push({ key: t.id, items: [t] });
  }
  return out;
}

const FILTERS = [
  { id: "all", label: "Tout" },
  { id: "in", label: "Entrées" },
  { id: "out", label: "Dépenses" },
];

export default function HistoryPage() {
  const [txs, setTxs] = useState<Tx[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [stale, setStale] = useState(false);

  useEffect(() => {
    (async () => {
      // Dernière liste gardée sur le téléphone : affichée tout de suite, et seule source hors ligne
      const cached = readCache<Tx[]>("dabali:tx");
      if (cached) setTxs(cached);
      const uid = await myId();
      if (!uid || !navigator.onLine) { setTxs((t) => t ?? []); setStale(true); return; }
      const { data, error } = await supabase().from("transactions").select("id, type, amount, balance_after, note, created_at, counterpart_name")
        .eq("user_id", uid).order("created_at", { ascending: false }).limit(150);
      if (error || !data) { setTxs((t) => t ?? []); setStale(true); return; }
      setTxs(data); setStale(false);
      writeCache("dabali:tx", data);
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

        {stale && <p className="mt-4 rounded-2xl bg-warn-soft px-4 py-2.5 text-sm font-semibold text-[#92400e]">Hors ligne : dernier historique enregistré sur ce téléphone.</p>}
        {txs === null && <div className="mt-4 h-64 animate-pulse rounded-[24px] bg-card" />}
        {Object.entries(groups).map(([day, items]) => (
          <section key={day} className="mt-5">
            <h2 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-muted">{relativeDay(day)}</h2>
            <div className="divide-y divide-line overflow-hidden rounded-[22px] bg-card shadow-[var(--shadow-card)]">
              {rows(items).map((r) => r.items.length === 1 ? <TxRow key={r.key} t={r.items[0]} /> : (
                <div key={r.key}>
                  <button onClick={() => setOpen((o) => ({ ...o, [r.key]: !o[r.key] }))} aria-expanded={!!open[r.key]}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-canvas">
                    <Icon t={r.items[0]} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{r.items.length} {r.items[0].type === "transfer_in" ? "envois reçus de" : "envois à"} {who(r.items[0])}</p>
                      <p className="flex items-center gap-1 truncate text-xs text-muted">
                        {time(r.items[r.items.length - 1].created_at)} – {time(r.items[0].created_at)}
                        <ChevronDown className={clsx("size-3.5 transition", open[r.key] && "rotate-180")} />
                      </p>
                    </div>
                    <Amount amount={r.items.reduce((n, t) => n + t.amount, 0)} after={r.items[0].balance_after} />
                  </button>
                  {open[r.key] && <div className="animate-rise border-t border-dashed border-line bg-canvas/60">{r.items.map((t) => <TxRow key={t.id} t={t} />)}</div>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

function Icon({ t }: { t: Tx }) {
  const m = META[t.type] ?? META.bonus;
  const I = m.icon;
  return <span className={clsx("grid size-10 shrink-0 place-items-center rounded-xl", m.bg)}><I className="size-[18px]" /></span>;
}

function Amount({ amount, after }: { amount: number; after: number }) {
  return (
    <div className="shrink-0 text-right">
      <p className={clsx("text-sm font-extrabold", amount > 0 ? "text-[#15803d]" : "text-ink")}>{signedFcfa(amount)}</p>
      <p className="text-[11px] text-muted">Solde {fcfa(after)}</p>
    </div>
  );
}

function TxRow({ t }: { t: Tx }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icon t={t} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{title(t)}</p>
        <p className="truncate text-xs text-muted">{detail(t)}</p>
      </div>
      <Amount amount={t.amount} after={t.balance_after} />
    </div>
  );
}
