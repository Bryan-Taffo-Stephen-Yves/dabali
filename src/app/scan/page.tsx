"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Check, X, LogOut, Sun, Moon, CameraOff, Keyboard } from "lucide-react";
import { edge, rpc, supabase } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import { todayISO, SERVICE_LABEL, time } from "@/lib/format";
import type { Extra } from "@/lib/types";

type Result =
  | { ok: true; client: string; dish: string; extras: Extra[]; counters?: { sold: number; served: number } }
  | { ok: false; code: string; message: string };

/** Service affiché par défaut : déjeuner avant 16h, dîner ensuite (heure d'Abidjan = UTC) */
function defaultService(): "lunch" | "dinner" {
  return new Date().getUTCHours() < 16 ? "lunch" : "dinner";
}

// Sons générés (aucun fichier à charger)
function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const notes = ok ? [880, 1320] : [220, 180];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = ok ? "sine" : "square";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.13);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.13 + (ok ? 0.12 : 0.22));
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.13);
      o.stop(ctx.currentTime + i * 0.13 + 0.25);
    });
    navigator.vibrate?.(ok ? 80 : [120, 60, 120]);
  } catch {}
}

export default function ScanPage() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [service, setService] = useState<"lunch" | "dinner">(defaultService);
  const [result, setResult] = useState<Result | null>(null);
  const [counters, setCounters] = useState<{ sold: number; served: number } | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [agent, setAgent] = useState<string>("");
  const [manual, setManual] = useState(false);
  const busy = useRef(false);
  const lastToken = useRef<{ t: string; at: number } | null>(null);
  const date = todayISO();

  const loadCounters = useCallback(() => {
    rpc<{ sold: number; served: number }>("service_counters", { p_date: date, p_service: service })
      .then((r) => r.ok !== false && setCounters(r as unknown as { sold: number; served: number }));
  }, [date, service]);

  useEffect(() => {
    loadCounters();
    const id = setInterval(loadCounters, 20_000);
    return () => clearInterval(id);
  }, [loadCounters]);

  useEffect(() => {
    supabase().auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase().from("profiles").select("full_name").eq("id", user.id).single();
      setAgent(data?.full_name ?? "");
    });
  }, []);

  const redeem = useCallback(async (token: string) => {
    const now = Date.now();
    if (busy.current) return;
    if (lastToken.current && lastToken.current.t === token && now - lastToken.current.at < 4000) return; // même QR encore devant la caméra
    busy.current = true;
    lastToken.current = { t: token, at: now };
    const r = await edge<{ client: string; dish: string; extras: Extra[]; counters: { sold: number; served: number } }>(
      "redeem-ticket", { token, service_date: date, service });
    const res = r as Result;
    setResult(res);
    beep(res.ok);
    if (res.ok && res.counters) setCounters(res.counters);
    setTimeout(() => { setResult(null); busy.current = false; }, res.ok ? 1800 : 2600);
  }, [date, service]);

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
      <header className="flex items-center justify-between gap-2 px-4 pb-3 pt-[max(0.8rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2"><Logo mark /><div>
          <p className="text-sm font-extrabold leading-tight">Scanner</p>
          <p className="text-[11px] text-white/60">{agent}</p>
        </div></div>
        <div className="flex rounded-full bg-white/10 p-1">
          {(["lunch", "dinner"] as const).map((s) => (
            <button key={s} onClick={() => setService(s)}
              className={clsx("flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition", service === s ? "bg-lime text-ink" : "text-white/70")}>
              {s === "lunch" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}{SERVICE_LABEL[s]}
            </button>
          ))}
        </div>
        <button onClick={logout} aria-label="Déconnexion" className="grid size-10 place-items-center rounded-full bg-white/10"><LogOut className="size-4" /></button>
      </header>

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
        <p className="absolute inset-x-0 bottom-4 text-center text-sm font-semibold text-white/80">Placez le QR du client dans le cadre</p>
      </div>

      <footer className="flex items-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        <div className="flex-1 rounded-2xl bg-white/10 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/60">{SERVICE_LABEL[service]} · servis / vendus</p>
          <p className="text-2xl font-extrabold"><span className="text-lime">{counters?.served ?? "–"}</span><span className="text-white/50"> / {counters?.sold ?? "–"}</span></p>
        </div>
        <button onClick={() => setManual(true)} className="grid size-14 place-items-center rounded-2xl bg-white/10" aria-label="Saisie manuelle"><Keyboard className="size-6" /></button>
      </footer>

      {manual && <ManualEntry onClose={() => setManual(false)} onSubmit={(t) => { setManual(false); redeem(t); }} />}

      {result && (
        <div className={clsx("fixed inset-0 z-50 flex flex-col items-center justify-center px-8 text-center", result.ok ? "bg-ok" : "bg-err")} role="alert">
          <span className="animate-pop grid size-32 place-items-center rounded-full bg-white">
            {result.ok ? <Check className="size-20 text-ok" strokeWidth={3} /> : <X className="size-20 text-err" strokeWidth={3} />}
          </span>
          {result.ok ? (
            <>
              <p className="mt-8 text-4xl font-extrabold">{result.client}</p>
              <p className="mt-2 text-2xl font-bold opacity-95">{result.dish}</p>
              {result.extras?.length > 0 && <p className="mt-3 rounded-full bg-white/20 px-4 py-1.5 text-lg font-bold">+ {result.extras.map((e) => e.name).join(" · ")}</p>}
              <p className="mt-6 text-sm font-semibold opacity-80">Validé à {time(new Date().toISOString())}</p>
            </>
          ) : (
            <>
              <p className="mt-8 text-4xl font-extrabold">Refusé</p>
              <p className="mt-3 max-w-sm text-2xl font-bold opacity-95">{result.message}</p>
            </>
          )}
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
