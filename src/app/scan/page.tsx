"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Check, X, LogOut, CameraOff, Keyboard, ShoppingCart, History, Volume2, VolumeX, Volume1 } from "lucide-react";
import Link from "next/link";
import { edge, rpc, supabase } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import { ServiceIcon } from "@/components/app/service-icon";
import { DishImage } from "@/components/app/dish-image";
import { currentService, fetchServices, type Services } from "@/lib/menu";
import { todayISO, SERVICE_LABEL } from "@/lib/format";
import { SERVICES, type Extra, type ServiceKind } from "@/lib/types";
import { audioPref, say, setAudioPref, soundError, soundOk, soundServed, type AudioPref } from "@/lib/scan-sounds";

type Dish = { menu_item_id: string; name: string; photo_url: string | null; available: boolean; left: number | null };
type Scan = { ticket_id: string; client: string; ticket: string; extras: Extra[]; dishes: Dish[]; batch_size?: number; remaining?: number; gift_from?: string | null; is_reward?: boolean };
type Fail = { code: string; message: string };
type Counters = { served: number; outstanding: number };

const SPOKEN: Record<string, string> = {
  ALREADY_USED: "Ticket déjà utilisé", EXPIRED: "Ticket expiré", INVALID_QR: "QR invalide", CANCELLED: "Ticket annulé",
  WRONG_SERVICE: "Mauvais service", SOLD_OUT: "Plat épuisé",
};

export default function ScanPage() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [services, setServices] = useState<Services | null>(null);

  // Fiche de courses attribuée à cet agent : pastille sur le panier (temps réel)
  const [shopping, setShopping] = useState(0);
  useEffect(() => {
    const sb = supabase();
    const count = async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data: l } = await sb.from("shopping_lists").select("id").eq("assigned_to", user.id).in("status", ["assigned", "shopping"]);
      if (!l?.length) return setShopping(0);
      const { count: n } = await sb.from("shopping_items").select("id", { count: "exact", head: true }).in("list_id", l.map((x) => x.id)).eq("status", "todo");
      setShopping(n ?? 0);
    };
    count();
    const ch = sb.channel("scan-shopping")
      .on("postgres_changes", { event: "*", schema: "public", table: "shopping_lists" }, count)
      .on("postgres_changes", { event: "*", schema: "public", table: "shopping_items" }, count).subscribe();
    return () => { sb.removeChannel(ch); };
  }, []);
  const [service, setService] = useState<ServiceKind>(() => currentService(null));
  const [scan, setScan] = useState<Scan | null>(null);
  const [fail, setFail] = useState<Fail | null>(null);
  const [served, setServed] = useState<string | null>(null);
  const [counters, setCounters] = useState<Counters | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [agent, setAgent] = useState("");
  const [manual, setManual] = useState(false);
  const [audioMode, setAudioMode] = useState<AudioPref>("on");
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setAudioMode(audioPref());
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const cycleAudio = () => {
    const next: AudioPref = audioMode === "on" ? "sound" : audioMode === "sound" ? "off" : "on";
    setAudioPref(next); setAudioMode(next);
    if (next !== "off") soundServed();
    if (next === "on") say("Voix activée");
  };
  const busy = useRef(false);
  const lastToken = useRef<{ t: string; at: number } | null>(null);
  const date = todayISO();

  const loadCounters = useCallback(() => {
    rpc<Counters>("service_counters", { p_date: date, p_service: service })
      .then((r) => r.ok !== false && setCounters(r as unknown as Counters));
  }, [date, service]);

  useEffect(() => { fetchServices().then((s) => { setServices(s); setService(currentService(s)); }); }, []);
  useEffect(() => { loadCounters(); const id = setInterval(loadCounters, 20_000); return () => clearInterval(id); }, [loadCounters]);
  useEffect(() => {
    supabase().auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase().from("profiles").select("full_name").eq("id", user.id).single();
      setAgent(data?.full_name ?? "");
    });
  }, []);

  const reset = useCallback(() => { setScan(null); setFail(null); setServed(null); busy.current = false; }, []);

  const redeem = useCallback(async (token: string) => {
    const now = Date.now();
    if (busy.current) return;
    if (lastToken.current && lastToken.current.t === token && now - lastToken.current.at < 4000) return;
    busy.current = true;
    lastToken.current = { t: token, at: now };
    if (/^DABALI:/i.test(token.trim())) {
      // QR de profil (transferts) présenté par erreur à la place du ticket
      soundError(); say("QR de profil, pas un ticket");
      setFail({ code: "PROFILE_QR", message: "C'est le QR de profil du client, pas un ticket. Il doit ouvrir « Mes tickets » et toucher son ticket." });
      setTimeout(reset, 3500);
      return;
    }
    const r = await edge<Scan>("redeem-ticket", { token, service_date: date, service });
    if (r.ok) {
      const sc = r as unknown as Scan;
      soundOk();
      const extras = sc.extras?.length ? `Avec ${sc.extras.map((e) => e.name).join(" et ")}.` : "Sans supplément.";
      say(`${sc.client.split(" ")[0]}. ${sc.ticket} valide. ${extras}`);
      setScan(sc); loadCounters();
    } else {
      soundError();
      say(SPOKEN[(r as Fail).code] ?? "Refusé");
      setFail(r as Fail); setTimeout(reset, 2800);
    }
  }, [date, service, loadCounters, reset]);

  async function serve(d: Dish) {
    if (!scan) return;
    const r = await rpc<{ dish: string }>("serve_dish", { p_ticket_id: scan.ticket_id, p_menu_item_id: d.menu_item_id });
    if (!r.ok) { setFail(r as Fail); soundError(); say(SPOKEN[(r as Fail).code] ?? "Refusé"); setScan(null); setTimeout(reset, 2500); return; }
    soundServed();
    setServed(r.dish);
    setScan(null);
    loadCounters();
    setTimeout(reset, 1300);
  }

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 });
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } },
          video.current!,
          (res) => { if (res && !cancelled) redeem(res.getText()); },
        );
        stop = () => controls.stop();
        if (cancelled) stop();
      } catch {
        setCamErr("Caméra inaccessible. Autorisez la caméra dans le navigateur (HTTPS requis).");
      }
    })();
    return () => { cancelled = true; stop?.(); };
  }, [redeem]);

  async function logout() {
    await supabase().auth.signOut();
    router.replace("/connexion");
  }

  return (
    <main className="no-overscroll fixed inset-0 flex flex-col bg-ink text-white">
      <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-[max(0.8rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2"><Logo mark /><div>
          <p className="text-sm font-extrabold leading-tight">Scanner</p>
          <p className="max-w-[46vw] truncate text-[11px] text-white/60">{agent}{now ? ` · ${now.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Abidjan" })} · ${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Abidjan" }).replace(":", "h")}` : ""}</p>
        </div></div>
        <span className="flex items-center gap-2">
          <button onClick={cycleAudio} aria-label={audioMode === "on" ? "Sons et voix activés" : audioMode === "sound" ? "Sons seuls" : "Muet"}
            title={audioMode === "on" ? "Sons + voix" : audioMode === "sound" ? "Sons seuls" : "Muet"}
            className={clsx("grid size-10 place-items-center rounded-full", audioMode === "off" ? "bg-white/10 text-white/50" : "bg-white/10")}>
            {audioMode === "on" ? <Volume2 className="size-4" /> : audioMode === "sound" ? <Volume1 className="size-4" /> : <VolumeX className="size-4" />}
          </button>
          <Link href="/scan/historique" aria-label="Historique des scans" className="grid size-10 place-items-center rounded-full bg-white/10"><History className="size-4" /></Link>
          <Link href="/courses" aria-label="Mes courses" className={clsx("relative grid size-10 place-items-center rounded-full", shopping ? "bg-lime text-ink" : "bg-white/10")}>
            <ShoppingCart className="size-4" />
            {shopping ? <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-err text-[10px] font-extrabold text-white">{shopping}</span> : null}
          </Link>
          <button onClick={logout} aria-label="Déconnexion" className="grid size-10 place-items-center rounded-full bg-white/10"><LogOut className="size-4" /></button>
        </span>
      </header>
      <div className="flex gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
        {SERVICES.map((s) => (
          <button key={s} onClick={() => setService(s)}
            className={clsx("flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition", service === s ? "bg-lime text-ink" : "bg-white/10 text-white/70")}>
            <ServiceIcon service={s} className="size-3.5" />{services?.[s].label ?? SERVICE_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="relative mx-4 flex-1 overflow-hidden rounded-[28px] bg-black">
        <video ref={video} className="size-full object-cover" muted playsInline />
        {!camErr && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="relative size-[68vmin] max-h-[340px] max-w-[340px]">
              {["left-0 top-0 border-l-[6px] border-t-[6px] rounded-tl-3xl", "right-0 top-0 border-r-[6px] border-t-[6px] rounded-tr-3xl",
                "left-0 bottom-0 border-l-[6px] border-b-[6px] rounded-bl-3xl", "right-0 bottom-0 border-r-[6px] border-b-[6px] rounded-br-3xl"].map((c) => (
                <span key={c} className={clsx("absolute size-14 border-lime", c)} />
              ))}
              <span className="absolute inset-x-4 top-1/2 h-0.5 animate-pulse bg-lime/80 shadow-[0_0_16px_#C8F135]" />
            </div>
          </div>
        )}
        {camErr && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
            <CameraOff className="size-10 text-white/50" /><p className="font-semibold text-white/80">{camErr}</p>
          </div>
        )}
        <p className="absolute inset-x-0 bottom-4 text-center text-sm font-semibold text-white/80">Ticket {SERVICE_LABEL[service]} · placez le QR dans le cadre</p>
      </div>

      <footer className="flex items-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        <div className="flex-1 rounded-2xl bg-white/10 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/60">{SERVICE_LABEL[service]} · servis aujourd&apos;hui</p>
          <p className="text-2xl font-extrabold"><span className="text-lime">{counters?.served ?? "–"}</span>
            <span className="text-base font-bold text-white/50"> · {counters?.outstanding ?? "–"} tickets en circulation</span></p>
        </div>
        <button onClick={() => setManual(true)} className="grid size-14 place-items-center rounded-2xl bg-white/10" aria-label="Saisie manuelle"><Keyboard className="size-6" /></button>
      </footer>

      {manual && <ManualEntry onClose={() => setManual(false)} onSubmit={(t) => { setManual(false); redeem(t); }} />}

      {/* Ticket validé : choix du plat servi */}
      {scan && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ok" role="dialog" aria-label="Ticket validé">
          <div className="flex items-center gap-4 px-5 pb-4 pt-[max(1.2rem,env(safe-area-inset-top))]">
            <span className="animate-pop grid size-16 shrink-0 place-items-center rounded-full bg-white"><Check className="size-10 text-ok" strokeWidth={3} /></span>
            <div className="min-w-0">
              <p className="truncate text-2xl font-extrabold">{scan.client}</p>
              <p className="text-lg font-bold opacity-90">Ticket {scan.ticket} valide</p>
            </div>
          </div>
          {/* Supplément : à servir en plus du plat (ou rien) */}
          {scan.extras?.length > 0 ? (
            <div className="mx-5 mb-3 rounded-2xl bg-white px-4 py-3 text-ink shadow-lg">
              <p className="text-xs font-extrabold uppercase tracking-wider text-[#15803d]">Supplément payé · à servir</p>
              {scan.extras.map((e) => (
                <p key={e.id} className="text-xl font-extrabold">+ {e.kind === "starter" ? "Entrée" : e.kind === "dessert" ? "Dessert" : "Extra"} : {e.name}</p>
              ))}
            </div>
          ) : (
            <p className="mx-5 mb-3 rounded-2xl bg-white/15 px-4 py-2.5 text-base font-bold">Sans supplément : plat seul</p>
          )}
          <div className="mx-5 mb-3 flex flex-wrap gap-2 text-sm font-bold">
            {scan.batch_size != null && scan.batch_size > 1 && <span className="rounded-full bg-white/20 px-3 py-1">Acheté avec {scan.batch_size - 1} autre{scan.batch_size > 2 ? "s" : ""} ticket{scan.batch_size > 2 ? "s" : ""}</span>}
            {scan.remaining != null && (
              <span className="rounded-full bg-white/20 px-3 py-1">
                {scan.remaining === 0 ? `Plus aucun ticket ${scan.ticket}` : `Il lui reste ${scan.remaining} ticket${scan.remaining > 1 ? "s" : ""} ${scan.ticket}`}
              </span>
            )}
            {scan.gift_from && <span className="rounded-full bg-white/20 px-3 py-1">🎁 Offert par {scan.gift_from}</span>}
            {scan.is_reward && <span className="rounded-full bg-white/20 px-3 py-1">⭐ Ticket fidélité</span>}
          </div>
          <p className="px-5 pb-2 text-sm font-bold uppercase tracking-wider opacity-80">Plat servi</p>
          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto px-5 pb-4">
            {scan.dishes.map((d) => (
              <button key={d.menu_item_id} disabled={!d.available} onClick={() => serve(d)}
                className="overflow-hidden rounded-3xl bg-white text-left text-ink shadow-lg transition active:scale-95 disabled:opacity-40">
                <DishImage name={d.name} src={d.photo_url} rounded="rounded-none" className="h-24 w-full" />
                <div className="p-3">
                  <p className="text-[15px] font-extrabold leading-tight">{d.name}</p>
                  <p className="mt-0.5 text-xs font-semibold text-muted">{!d.available ? "Épuisé" : d.left === null ? "Disponible" : `${d.left} restants`}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button onClick={reset} className="h-12 w-full rounded-full bg-white/20 font-bold">Plat non précisé</button>
          </div>
        </div>
      )}

      {served && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ok px-8 text-center" role="alert">
          <span className="animate-pop grid size-28 place-items-center rounded-full bg-white"><Check className="size-16 text-ok" strokeWidth={3} /></span>
          <p className="mt-6 text-3xl font-extrabold">Servi</p>
          <p className="mt-2 text-xl font-bold opacity-95">{served}</p>
        </div>
      )}

      {fail && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-err px-8 text-center" role="alert">
          <span className="animate-pop grid size-32 place-items-center rounded-full bg-white"><X className="size-20 text-err" strokeWidth={3} /></span>
          <p className="mt-8 text-4xl font-extrabold">Refusé</p>
          <p className="mt-3 max-w-sm text-2xl font-bold opacity-95">{fail.message}</p>
        </div>
      )}
    </main>
  );
}

function ManualEntry({ onClose, onSubmit }: { onClose: () => void; onSubmit: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/60" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSubmit(v.trim()); }}
        className="w-full rounded-t-[28px] bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink">
        <p className="font-extrabold">Saisie manuelle du code</p>
        <p className="text-sm text-muted">Collez le contenu du QR (utile si la caméra est défaillante).</p>
        <textarea value={v} onChange={(e) => setV(e.target.value)} rows={3} autoFocus
          className="mt-3 w-full rounded-2xl border border-line p-3 font-mono text-sm outline-none focus:border-ink" />
        <button className="mt-3 h-12 w-full rounded-full bg-ink font-bold text-white">Valider</button>
      </form>
    </div>
  );
}
