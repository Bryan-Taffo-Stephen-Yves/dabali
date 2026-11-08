"use client";
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
  const [picked, setPicked] = useState<string[]>([]);
  const [gift, setGift] = useState<Recipient | null>(null);
  const [giftOpen, setGiftOpen] = useState(false);
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
  const chosen = withExtras ? extras.filter((e) => picked.includes(e.id)) : [];
  const unit = (cfg?.price ?? 0) + chosen.reduce((s, e) => s + e.price, 0);
  const canReward = service === "breakfast" && (profile?.points ?? 0) >= 10;
  const total = unit * qty - (useReward && canReward ? unit : 0);
  const needsPin = total > 5000 || !!gift;
  const insufficient = balance !== null && balance < total;

  const pick = (e: Extra) => setPicked((p) => (p.includes(e.id) ? p.filter((x) => x !== e.id)
    : [...p.filter((x) => extras.find((y) => y.id === x)?.kind !== e.kind), e.id]));

  const buy = useCallback(async (pin?: string) => {
    if (!service) return;
    setBusy(true);
    const r = await rpc<{ ticket_ids: string[]; total: number }>("purchase_tickets", {
      p_service: service, p_quantity: qty, p_extra_ids: withExtras ? picked : [], p_pin: pin ?? null,
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
    if (gift) { toast("ok", `${n} ticket${n > 1 ? "s" : ""} offert${n > 1 ? "s" : ""} à ${gift.full_name.split(" ")[0]} 🎁`); router.replace("/app"); return; }
    await syncTokens();
    toast("ok", n > 1 ? `${n} tickets ${cfg?.label} ajoutés` : `Ticket ${cfg?.label} prêt`);
    router.replace(n === 1 ? `/app/tickets/${r.ticket_ids[0]}` : "/app/tickets");
  }, [service, qty, withExtras, picked, gift, useReward, canReward, refresh, router, toast, cfg]);

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

        {/* Suppléments */}
        {withExtras && (
          <section className="mt-5">
            <h2 className="mb-1 text-[15px] font-extrabold">Supplément <span className="text-sm font-semibold text-muted">facultatif, par ticket</span></h2>
            {([["starter", "Entrée"], ["dessert", "Dessert"]] as const).map(([kind, title]) => (
              <div key={kind} className="mt-3">
                <p className="mb-2 text-[13px] font-extrabold text-ink-2">{title} <span className="font-medium text-muted">une au choix</span></p>
                <div className="flex flex-wrap gap-2">
                  {extras.filter((e) => e.kind === kind).map((e) => {
                    const on = picked.includes(e.id);
                    return (
                      <button key={e.id} onClick={() => pick(e)}
                        className={clsx("flex items-center gap-1.5 rounded-full border-2 px-3.5 py-2 text-sm font-bold transition",
                          on ? "border-ink bg-ink text-white" : "border-line bg-card")}>
                        {on && <Check className="size-4 text-lime" strokeWidth={3} />}{e.name}
                        <span className={on ? "text-lime" : "text-muted"}>+{fcfa(e.price, false)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
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
          {qty} ticket{qty > 1 ? "s" : ""} {cfg?.label ?? ""} <span className="text-lime">·</span> {fcfa(total)}
        </Button>
      </div>

      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Confirmer l'achat">
        <p className="-mt-2 mb-4 text-sm text-muted">{qty} × ticket {cfg?.label}{gift ? ` pour ${gift.full_name}` : ""} · <b className="text-ink">{fcfa(total)}</b></p>
        <PinPad onComplete={(p) => buy(p)} error={pinError} busy={busy} />
      </Sheet>
      <RecipientSheet title="Offrir des tickets" open={giftOpen} onClose={() => setGiftOpen(false)} onPick={(u) => { setGift(u); setGiftOpen(false); }} />
    </main>
  );
}
