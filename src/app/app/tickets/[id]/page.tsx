"use client";
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ArrowLeftRight, Check, ChevronLeft, Sun, WifiOff, Star, XCircle } from "lucide-react";
import { rpc, supabase } from "@/lib/supabase/client";
import { Qr } from "@/components/qr";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAppData } from "@/components/app/app-data";
import { ServiceBadge } from "@/components/app/service-icon";
import { cachedTicket, cachedToken, displayStatus, STATUS_META, syncTokens } from "@/lib/tickets";
import { SERVICE_LABEL, duration, fcfa, shortDateTime } from "@/lib/format";
import { TICKET_COLUMNS, type Ticket } from "@/lib/types";

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { balance, profile, refresh } = useAppData();
  const [t, setT] = useState<Ticket | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [justScanned, setJustScanned] = useState(false);
  const last = useRef<string | undefined>(undefined);

  useEffect(() => {
    // 1) cache local : affichage immédiat, y compris en mode avion
    const c = cachedTicket(id);
    if (c) { setT(c); last.current = c.status; }
    setToken(cachedToken(id));
    setOffline(!navigator.onLine);

    // 2) réseau
    const sb = supabase();
    const load = async () => {
      const { data } = await sb.from("tickets").select(TICKET_COLUMNS).eq("id", id).single();
      if (!data) return;
      const nt = data as unknown as Ticket;
      if (last.current === "valid" && nt.status === "used") { setJustScanned(true); navigator.vibrate?.(120); refresh(); }
      last.current = nt.status;
      setT(nt);
    };
    load();
    syncTokens().then(() => setToken(cachedToken(id)));

    // 3) passage au vert en direct (temps réel + filet de sécurité toutes les 4 s : le plat arrive juste après le scan)
    const ch = sb.channel(`ticket-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tickets", filter: `id=eq.${id}` }, () => load())
      .subscribe();
    const poll = setInterval(() => { if (navigator.onLine && !document.hidden) load(); }, 4000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener("online", on); window.addEventListener("offline", off);

    // écran allumé tant que le QR est affiché
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } })
      .wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});

    return () => {
      sb.removeChannel(ch); clearInterval(poll); clearInterval(tick);
      window.removeEventListener("online", on); window.removeEventListener("offline", off);
      lock?.release().catch(() => {});
    };
  }, [id, refresh]);

  if (!t) return <main className="p-4"><div className="mx-auto mt-16 h-[520px] animate-pulse rounded-[32px] bg-card" /></main>;

  const st = displayStatus(t, now);
  const label = SERVICE_LABEL[t.service];
  const ends = new Date(t.valid_until).getTime();
  const step = st === "used" ? 3 : 2;

  async function cancel() {
    if (!confirm(`Annuler ce ticket ${label} ? ${t!.total > 0 ? fcfa(t!.total) + " seront remboursés sur votre solde." : ""}`)) return;
    const r = await rpc<{ refunded: number }>("cancel_ticket", { p_ticket_id: id });
    if (!r.ok) return toast("err", r.message);
    toast("ok", r.refunded > 0 ? `${fcfa(r.refunded)} remboursés sur votre solde.` : "Ticket annulé, points rendus.");
    refresh();
    router.replace("/app/tickets");
  }

  return (
    <main className="no-overscroll px-4 pb-6 pt-[max(0.9rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <button onClick={() => router.push("/app/tickets")} aria-label="Retour" className="grid size-11 place-items-center rounded-full bg-card shadow-[var(--shadow-card)]">
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="text-[17px] font-extrabold">Mon ticket</h1>
        <span className={clsx("rounded-full px-3 py-1 text-xs font-extrabold", STATUS_META[st].chip)}>{STATUS_META[st].label}</span>
      </header>

      {offline && (
        <p className="mt-3 flex items-center justify-center gap-2 rounded-full bg-ink px-3 py-2 text-xs font-bold text-white">
          <WifiOff className="size-4 text-lime" /> Hors ligne : votre QR reste valable
        </p>
      )}

      {/* Talon */}
      <section className="relative mt-4 drop-shadow-[0_10px_30px_rgba(22,24,29,0.10)]">
        <div className="rounded-t-[30px] bg-card px-6 pb-6 pt-6">
          <div className="relative mx-auto w-full max-w-[290px]">
            <Qr value={st === "valid" ? token : null} className={clsx("rounded-2xl p-3 ring-1 ring-line transition", st !== "valid" && "opacity-20 blur-[3px]")} />
            {st !== "valid" && (
              <div className="absolute inset-0 grid place-items-center">
                <span className={clsx("grid size-20 place-items-center rounded-full", st === "used" ? "bg-ok text-white" : "bg-err text-white")}>
                  {st === "used" ? <Check className="size-10" strokeWidth={3} /> : <XCircle className="size-10" />}
                </span>
              </div>
            )}
            {st === "valid" && !token && (
              <p className="absolute inset-x-0 -bottom-5 text-center text-xs font-semibold text-muted">{offline ? "QR non disponible hors ligne" : "Génération du QR…"}</p>
            )}
          </div>
          <p className="mt-6 text-center text-sm font-semibold text-muted">
            {st === "valid" ? "Présentez ce code au comptoir, choisissez votre plat"
              : st === "used" ? `Utilisé le ${shortDateTime(t.used_at!)}`
              : st === "expired" ? (t.total > 0 ? "Non utilisé : remboursé sur ton solde" : "Non utilisé : tes points t'ont été rendus") : "Ticket annulé et remboursé"}
          </p>
        </div>

        <div className="relative h-6 bg-card">
          <span className="absolute -left-3 top-0 size-6 rounded-full bg-canvas" />
          <span className="absolute -right-3 top-0 size-6 rounded-full bg-canvas" />
          <span className="absolute inset-x-6 top-1/2 border-t-2 border-dashed border-line" />
        </div>

        <div className="rounded-b-[30px] bg-card px-6 pb-6 pt-3 text-center">
          <div className="flex items-center justify-center gap-3">
            <ServiceBadge service={t.service} size="size-11" />
            <h2 className="text-[22px] font-extrabold leading-tight">Ticket {label}{t.is_reward && " 🎁"}</h2>
          </div>
          {t.gift_from && <p className="mx-auto mt-2 w-fit rounded-full bg-lime-soft px-3 py-1 text-sm font-bold text-lime-deep">🎁 Offert par {t.gift_from}</p>}
          {st === "used" && t.dish && <p className="mt-2 text-sm font-bold text-ink-2">Servi : {t.dish.name}</p>}
          {t.extras.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {t.extras.map((e) => <span key={e.id} className="rounded-full bg-canvas px-2.5 py-1 text-xs font-bold">+ {e.name}</span>)}
            </div>
          )}
          {st === "valid" && (
            <>
              <p className="mt-4 text-[30px] font-extrabold tracking-tight text-lime-deep">
                <span className="text-base font-bold text-muted">valable encore </span>{duration(ends - now)}
              </p>
              <p className="text-xs font-semibold text-muted">jusqu&apos;au {shortDateTime(t.valid_until)}</p>
            </>
          )}

          <ol className="mt-5 flex items-center">
            {["Acheté", "Valide", "Utilisé"].map((s, i) => (
              <li key={s} className="flex flex-1 items-center">
                <div className="flex flex-col items-center gap-1">
                  <span className={clsx("grid size-7 place-items-center rounded-full text-xs font-extrabold transition",
                    i + 1 < step || step === 3 ? "bg-ink text-lime" : i + 1 === step ? "bg-lime text-ink ring-4 ring-lime-soft" : "bg-canvas text-off")}>
                    {i + 1 < step || step === 3 ? <Check className="size-4" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={clsx("text-[11px] font-bold", i + 1 <= step ? "text-ink" : "text-off")}>{s}</span>
                </div>
                {i < 2 && <span className={clsx("mx-1 mb-5 h-0.5 flex-1 rounded", i + 1 < step ? "bg-ink" : "bg-line")} />}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Solde ⇄ Points */}
      <section className="mt-4 flex items-center rounded-[24px] bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex-1 text-center">
          <p className="text-xs font-bold text-muted">Solde</p>
          <p className="text-xl font-extrabold">{balance === null ? "—" : fcfa(balance)}</p>
        </div>
        <span className="grid size-11 place-items-center rounded-full bg-lime ring-4 ring-lime-soft"><ArrowLeftRight className="size-5" /></span>
        <div className="flex-1 text-center">
          <p className="text-xs font-bold text-muted">Points</p>
          <p className="text-xl font-extrabold">{profile?.points ?? "—"}<span className="text-sm text-muted">/10</span></p>
        </div>
      </section>

      {st === "valid" && (
        <>
          <p className="mt-4 flex items-center justify-center gap-2 text-xs font-semibold text-muted">
            <Sun className="size-4" /> Montez la luminosité pour un scan instantané
          </p>
          <Button variant="ghost" block className="mt-2 text-err" onClick={cancel}>Annuler et me faire rembourser</Button>
        </>
      )}

      {justScanned && <ScannedOverlay ticket={t} onClose={() => setJustScanned(false)} />}
    </main>
  );
}

function ScannedOverlay({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const toast = useToast();
  const [stars, setStars] = useState(0);
  const [sent, setSent] = useState(false);
  async function rate(n: number) {
    setStars(n);
    const r = await rpc("rate_ticket", { p_ticket_id: ticket.id, p_stars: n });
    if (r.ok) { setSent(true); toast("ok", "Merci pour votre avis !"); setTimeout(onClose, 900); }
    else toast("err", r.message);
  }
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ok px-8 text-center text-white">
      <span className="animate-pop grid size-28 place-items-center rounded-full bg-white text-ok"><Check className="size-16" strokeWidth={3} /></span>
      <h2 className="mt-6 text-3xl font-extrabold">Bon appétit !</h2>
      <p className="mt-2 text-lg font-semibold opacity-90">{ticket.dish ? ticket.dish.name : `Ticket ${SERVICE_LABEL[ticket.service]} validé`}</p>
      {ticket.dish ? (
        <div className="mt-10 rounded-3xl bg-white/15 p-5">
          <p className="font-bold">Comment était votre {ticket.dish.name.split(" ")[0].toLowerCase()} ?</p>
          <div className="mt-3 flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => !sent && rate(n)} aria-label={`${n} étoiles`} className="p-1 active:scale-90">
                <Star className={clsx("size-9", n <= stars ? "fill-white text-white" : "text-white/60")} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-8 text-sm font-semibold opacity-80">L&apos;agent enregistre votre plat…</p>
      )}
      <button onClick={onClose} className="mt-8 text-sm font-bold underline underline-offset-4 opacity-90">Plus tard</button>
    </div>
  );
}
