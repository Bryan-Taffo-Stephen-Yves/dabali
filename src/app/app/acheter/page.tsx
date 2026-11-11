"use client";
import { Bitmoji } from "@/components/bitmoji";
import { buzz } from "@/lib/confetti";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { Minus, Plus, Check, Gift, Sparkles, Clock } from "lucide-react";
import { rpc, supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/app/page-header";
import { ServiceBadge } from "@/components/app/service-icon";
import { RecipientSheet, type Recipient } from "@/components/app/recipient-sheet";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { PinPad } from "@/components/ui/pin-pad";
import { useToast } from "@/components/ui/toast";
import { useAppData } from "@/components/app/app-data";
import { currentService, fetchServices, type Services } from "@/lib/menu";
import { syncTokens } from "@/lib/tickets";
import { fcfa } from "@/lib/format";
import { SERVICES, type Extra, type ServiceKind } from "@/lib/types";

export default function BuyPage() {
  return <Suspense><Buy /></Suspense>;
}

function Buy() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { balance, profile, refresh } = useAppData();
  const [services, setServices] = useState<Services | null>(null);
  const [service, setService] = useState<ServiceKind | null>((params.get("service") as ServiceKind) || null);
  const [qty, setQty] = useState(1);
  const [extras, setExtras] = useState<Extra[]>([]);
  // Suppléments en quantité : { idSupplément: nombre } ; par type, au plus 1 par ticket
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [gift, setGift] = useState<Recipient | null>(null);
  const [giftOpen, setGiftOpen] = useState(false);
  // Depuis l'accueil (« Offrir ») : la recherche du bénéficiaire s'ouvre directement
  useEffect(() => { if (params.get("offrir")) setGiftOpen(true); }, [params]);
  const [useReward, setUseReward] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [validity, setValidity] = useState(48);

  useEffect(() => {
    fetchServices().then((s) => { setServices(s); setService((cur) => cur ?? currentService(s)); });
    const sb = supabase();
    sb.from("extras").select("id, name, price, kind").eq("is_active", true).in("kind", ["starter", "dessert"]).order("sort")
      .then(({ data }) => setExtras((data ?? []) as Extra[]));
    sb.from("settings").select("value").eq("key", "ticket_validity_hours").maybeSingle()
      .then(({ data }) => data && setValidity(Number(data.value)));
  }, []);

  const cfg = services && service ? services[service] : null;
  const withExtras = !!cfg?.extras;
  const chosen = withExtras ? extras.filter((e) => (counts[e.id] ?? 0) > 0) : [];
  const extrasTotal = chosen.reduce((s, e) => s + e.price * (counts[e.id] ?? 0), 0);
  const usedOf = (kind: Extra["kind"]) => extras.filter((e) => e.kind === kind).reduce((n, e) => n + (counts[e.id] ?? 0), 0);
  const canReward = service === "breakfast" && (profile?.points ?? 0) >= 10;
  const total = (cfg?.price ?? 0) * qty + extrasTotal - (useReward && canReward ? (cfg?.price ?? 0) : 0);
  const extrasCount = chosen.reduce((n, e) => n + (counts[e.id] ?? 0), 0);
  const needsPin = total > 5000 || !!gift;
  const insufficient = balance !== null && balance < total;

  // + / − sur un supplément (jamais plus que le nombre de tickets pour un même type)
  const bump = (e: Extra, d: number) => setCounts((c) => {
    const cur = c[e.id] ?? 0;
    const used = extras.filter((x) => x.kind === e.kind).reduce((n, x) => n + (c[x.id] ?? 0), 0);
    const next = Math.max(0, d > 0 && used >= qty ? cur : cur + d);
    return { ...c, [e.id]: next };
  });
  // « Pour tous » : ce supplément sur chaque ticket encore libre de ce type
  const fillAll = (e: Extra) => setCounts((c) => {
    const others = extras.filter((x) => x.kind === e.kind && x.id !== e.id).reduce((n, x) => n + (c[x.id] ?? 0), 0);
    return { ...c, [e.id]: Math.max(0, qty - others) };
  });
  // Moins de tickets : on retire les suppléments en trop (en partant des derniers choisis)
  useEffect(() => {
    setCounts((c) => {
      const out = { ...c };
      for (const kind of ["starter", "dessert"] as const) {
        let over = extras.filter((x) => x.kind === kind).reduce((n, x) => n + (out[x.id] ?? 0), 0) - qty;
        for (const x of [...extras].reverse()) {
          if (over <= 0) break;
          if (x.kind !== kind || !out[x.id]) continue;
          const cut = Math.min(over, out[x.id]); out[x.id] -= cut; over -= cut;
        }
      }
      return out;
    });
  }, [qty, extras]);

  const [printed, setPrinted] = useState<{ n: number; label: string; service: ServiceKind; to?: string } | null>(null);
  const buy = useCallback(async (pin?: string) => {
    if (!service) return;
    setBusy(true);
    const r = await rpc<{ ticket_ids: string[]; total: number }>("purchase_tickets", {
      p_service: service, p_quantity: qty, p_extras: withExtras ? chosen.map((e) => ({ id: e.id, qty: counts[e.id] })) : [], p_pin: pin ?? null,
      p_beneficiary_id: gift?.id ?? null, p_use_reward: useReward && canReward,
    });
    setBusy(false);
    if (!r.ok) {
      if (r.code === "PIN_NOT_SET") { setPinOpen(false); toast("err", "Crée d'abord ton code PIN."); router.push("/app/profil?pin=new&back=/app/acheter"); return; }
      if (r.code.startsWith("PIN")) { setPinError(r.message); setPinOpen(true); return; }
      setPinOpen(false); toast("err", r.message); return;
    }
    setPinOpen(false);
    refresh();
    const n = r.ticket_ids.length;
    // Le ticket « sort de l'imprimante », petite vibration, puis on ouvre le QR
    setPrinted({ n, label: cfg?.label ?? "", service, to: gift?.full_name.split(" ")[0] });
    buzz([20, 60, 40]);
    const wait = new Promise((ok) => setTimeout(ok, 1700));
    if (gift) { await wait; router.replace("/app"); return; }
    await Promise.all([syncTokens(), wait]);
    router.replace(n === 1 ? `/app/tickets/${r.ticket_ids[0]}` : "/app/tickets");
  }, [service, qty, withExtras, chosen, counts, gift, useReward, canReward, refresh, router, toast, cfg]);


  return (
    <main className="pb-40">
      <PageHeader title="Acheter des tickets" />
      <div className="px-4">
        <p className="text-sm font-semibold text-muted">Le plat se choisit au comptoir. Ticket valable {validity} h pour le repas choisi.</p>

        {/* Type de repas */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {SERVICES.map((s) => {
            const c = services?.[s];
            const on = service === s;
            return (
              <button key={s} onClick={() => { setService(s); setUseReward(false); }}
                className={clsx("flex flex-col items-start gap-2 rounded-[22px] border-2 bg-card p-3.5 text-left transition active:scale-[0.98]",
                  on ? "border-ink" : "border-transparent shadow-[var(--shadow-card)]")}>
                <div className="flex w-full items-start justify-between">
                  <ServiceBadge service={s} size="size-11" />
                  <span className={clsx("grid size-6 place-items-center rounded-full border-2", on ? "border-ink bg-ink" : "border-line")}>
                    {on && <Check className="size-3.5 text-lime" strokeWidth={3} />}
                  </span>
                </div>
                <div>
                  <p className="font-extrabold">{c?.label ?? "…"}</p>
                  <p className="flex items-center gap-1 text-xs font-semibold text-muted"><Clock className="size-3" />{c ? `${c.start.replace(":", "h")} – ${c.end.replace(":", "h")}` : ""}</p>
                </div>
                <p className="text-lg font-extrabold">{c ? fcfa(c.price) : "…"}</p>
              </button>
            );
          })}
        </div>

        {/* Quantité */}
        <div className="mt-5 flex items-center justify-between rounded-[22px] bg-card p-4 shadow-[var(--shadow-card)]">
          <div>
            <p className="font-bold">Nombre de tickets</p>
            <p className="text-xs text-muted">Jusqu&apos;à 10 par achat</p>
          </div>
          <div className="flex items-center gap-3">
            <button aria-label="Moins" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)}
              className="grid size-11 place-items-center rounded-full bg-canvas disabled:opacity-40 active:scale-95"><Minus className="size-5" /></button>
            <span className="w-7 text-center text-2xl font-extrabold">{qty}</span>
            <button aria-label="Plus" disabled={qty >= 10} onClick={() => setQty((q) => q + 1)}
              className="grid size-11 place-items-center rounded-full bg-lime disabled:opacity-40 active:scale-95"><Plus className="size-5" /></button>
          </div>
        </div>

        {/* Suppléments : quantité par article, au plus 1 entrée et 1 dessert par ticket */}
        {withExtras && (
          <section className="mt-5">
            <h2 className="text-[15px] font-extrabold">Suppléments <span className="text-sm font-semibold text-muted">facultatifs</span></h2>
            <p className="text-xs font-medium text-muted">1 entrée et 1 dessert au maximum par ticket</p>
            {([["starter", "Entrées"], ["dessert", "Desserts"]] as const).map(([kind, title]) => {
              const used = usedOf(kind);
              return (
                <div key={kind} className="mt-3 overflow-hidden rounded-[22px] bg-card shadow-[var(--shadow-card)]">
                  <div className="flex items-center justify-between px-4 pb-1 pt-3">
                    <p className="text-[14px] font-extrabold">{title}</p>
                    <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-extrabold", used ? "bg-ink text-lime" : "bg-canvas text-muted")}>{used} / {qty}</span>
                  </div>
                  <div className="divide-y divide-line">
                    {extras.filter((e) => e.kind === kind).map((e) => {
                      const n = counts[e.id] ?? 0;
                      return (
                        <div key={e.id} className="flex items-center gap-2 px-4 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold">{e.name}</p>
                            <p className="text-xs font-semibold text-muted">+{fcfa(e.price)}{n > 1 ? ` · ${fcfa(e.price * n)}` : ""}</p>
                          </div>
                          {qty > 1 && n < qty - (used - n) && (
                            <button onClick={() => fillAll(e)} className="rounded-full bg-canvas px-2.5 py-1 text-[11px] font-bold text-ink-2 active:scale-95">Pour tous</button>
                          )}
                          <button aria-label={`Moins de ${e.name}`} disabled={n === 0} onClick={() => bump(e, -1)}
                            className="grid size-9 place-items-center rounded-full bg-canvas disabled:opacity-30 active:scale-95"><Minus className="size-4" /></button>
                          <span className={clsx("w-6 text-center text-base font-extrabold", n ? "text-ink" : "text-off")}>{n}</span>
                          <button aria-label={`Plus de ${e.name}`} disabled={used >= qty} onClick={() => bump(e, 1)}
                            className="grid size-9 place-items-center rounded-full bg-lime disabled:opacity-30 active:scale-95"><Plus className="size-4" /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {canReward && (
          <button onClick={() => setUseReward((v) => !v)}
            className={clsx("mt-5 flex w-full items-center gap-3 rounded-2xl p-3.5 text-left transition", useReward ? "bg-lime" : "bg-lime-soft")}>
            <Sparkles className="size-5 shrink-0" />
            <span className="flex-1 text-sm font-bold">1 petit-déjeuner offert avec 10 points<span className="block text-xs font-medium text-ink-2">Vous avez {profile?.points} points</span></span>
            <span className={clsx("h-6 w-10 rounded-full p-0.5 transition", useReward ? "bg-ink" : "bg-white")}>
              <span className={clsx("block size-5 rounded-full transition", useReward ? "translate-x-4 bg-lime" : "bg-line")} />
            </span>
          </button>
        )}

        <button onClick={() => (gift ? setGift(null) : setGiftOpen(true))}
          className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-card p-3.5 text-left shadow-[var(--shadow-card)]">
          <span className="grid size-10 place-items-center rounded-xl bg-canvas"><Gift className="size-5" /></span>
          <span className="flex-1 text-sm font-bold">{gift ? `Pour ${gift.full_name}` : "Offrir ces tickets"}
            <span className="block text-xs font-medium text-muted">{gift ? "Touchez pour annuler" : "Ils arrivent directement chez la personne"}</span>
          </span>
        </button>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md bg-gradient-to-t from-canvas via-canvas to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
        {insufficient && (
          <p className="mb-2 rounded-xl bg-err-soft px-3 py-2 text-center text-[13px] font-bold text-err">
            Solde insuffisant ({fcfa(balance ?? 0)}). <a href="/app/recharger" className="underline">Recharger</a>
          </p>
        )}
        <Button size="lg" block variant="dark" disabled={!cfg || insufficient} loading={busy}
          onClick={() => (needsPin ? (setPinError(null), setPinOpen(true)) : buy())}>
          {qty} ticket{qty > 1 ? "s" : ""} {cfg?.label ?? ""}{extrasCount ? ` + ${extrasCount} suppl.` : ""} <span className="text-lime">·</span> {fcfa(total)}
        </Button>
      </div>

      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Confirmer l'achat">
        <p className="-mt-2 mb-4 text-sm text-muted">{qty} × ticket {cfg?.label}{chosen.length ? ` + ${chosen.map((e) => `${counts[e.id]} ${e.name}`).join(", ")}` : ""}{gift ? ` pour ${gift.full_name}` : ""} · <b className="text-ink">{fcfa(total)}</b></p>
        <PinPad onComplete={(p) => buy(p)} error={pinError} busy={busy} />
      </Sheet>
      <RecipientSheet title="Offrir des tickets" open={giftOpen} onClose={() => setGiftOpen(false)} onPick={(u) => { setGift(u); setGiftOpen(false); }} />
      {printed && <PrintOverlay {...printed} hours={validity} avatar={profile?.avatar} seed={profile?.id} />}
    </main>
  );
}

/** Achat réussi : le ticket sort d'une fente, comme d'une imprimante */
function PrintOverlay({ n, label, service, to, hours, avatar, seed }: { n: number; label: string; service: ServiceKind; to?: string; hours: number | string; avatar?: string | null; seed?: string }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-ink px-8 text-white" role="status">
      <div className="w-64">
        <div className="relative z-10 h-4 rounded-full bg-[#2a2d34] shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]" />
        <div className="-mt-2 overflow-hidden px-3 pt-2">
          <div className="animate-print rounded-b-2xl bg-white px-5 pb-5 pt-6 text-center text-ink">
            <ServiceBadge service={service} size="size-12" className="mx-auto" />
            <p className="mt-3 text-xl font-extrabold">{n > 1 ? `${n} tickets` : "Ticket"} {label}</p>
            <div className="my-3 border-t-2 border-dashed border-line" />
            <p className="text-sm font-bold text-muted">{to ? `Offert à ${to} 🎁` : `Valable ${hours} h · QR prêt`}</p>
          </div>
        </div>
      </div>
      <div className="animate-rise mt-8 flex items-center gap-3" style={{ animationDelay: "0.9s" }}>
        <Bitmoji avatar={avatar} seed={seed} mood={to ? "wink" : "wow"} className="size-16 ring-4 ring-lime" />
        <p className="text-2xl font-extrabold">{to ? "Cadeau envoyé !" : "C'est acheté !"}</p>
      </div>
    </div>
  );
}
