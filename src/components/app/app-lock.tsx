"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, ScanFace } from "lucide-react";
import { useAppData } from "@/components/app/app-data";
import { Bitmoji } from "@/components/bitmoji";
import { PinPad } from "@/components/ui/pin-pad";
import { supabase } from "@/lib/supabase/client";
import { biometricLabel, confirmWithPin, prepareBiometric, unlockBiometric } from "@/lib/biometric";

const UNLOCK_KEY = "dabali:unlocked-at";
const RELOCK_MS = 5 * 60_000; // revient verrouillée après 5 min en arrière-plan

/** Verrouillage de l'appli par Face ID (si activé dans le Profil). Code PIN en secours. */
export function AppLock() {
  const router = useRouter();
  const { profile } = useAppData();
  const enabled = !!profile?.biometric_enabled;
  const [locked, setLocked] = useState(false);
  const [usePin, setUsePin] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hiddenAt = useRef<number | null>(null);

  // Verrouillée à l'ouverture si Face ID est activé et pas encore déverrouillée dans cette session
  useEffect(() => {
    if (!enabled) { setLocked(false); return; }
    let last = 0;
    try { last = Number(sessionStorage.getItem(UNLOCK_KEY) ?? 0); } catch {}
    if (Date.now() - last > RELOCK_MS) setLocked(true);
  }, [enabled]);

  // Retour dans l'appli après plus de 5 min : on reverrouille
  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (document.hidden) { hiddenAt.current = Date.now(); return; }
      if (hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_MS) setLocked(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [enabled]);

  useEffect(() => { if (locked) void prepareBiometric(); }, [locked]);

  const done = () => {
    try { sessionStorage.setItem(UNLOCK_KEY, String(Date.now())); } catch {}
    setLocked(false); setUsePin(false); setErr(null);
  };
  const face = async () => {
    setErr(null); setBusy(true);
    const r = await unlockBiometric();
    setBusy(false);
    if (r.ok) done(); else setErr(r.message);
  };
  const pin = useCallback(async (p: string) => {
    setBusy(true);
    const r = await confirmWithPin(p);
    setBusy(false);
    if (r.ok) done(); else setErr(r.message);
  }, []);
  const logout = async () => { await supabase().auth.signOut(); router.replace("/connexion"); };

  if (!locked) return null;
  return (
    <div className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-lime px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-center" role="dialog" aria-label="Dabali est verrouillée">
      <svg className="pointer-events-none absolute -right-16 -top-10 size-72 text-white/30" viewBox="0 0 200 200" aria-hidden><circle cx="100" cy="100" r="70" fill="none" stroke="currentColor" strokeWidth="26" /></svg>
      <div className="relative">
        <Bitmoji avatar={profile?.avatar} seed={profile?.id} mood="wink" className="size-24 ring-4 ring-white" />
        <span className="absolute -bottom-1 -right-1 grid size-10 place-items-center rounded-full bg-ink"><Lock className="size-5 text-lime" /></span>
      </div>
      <h1 className="mt-5 text-[26px] font-extrabold">Dabali est verrouillée</h1>
      <p className="mt-1 text-sm font-semibold text-ink/70">Bonjour {profile?.full_name?.split(" ")[0]}, confirmez que c&apos;est bien vous.</p>
      {!usePin ? (
        <>
          <button onClick={face} disabled={busy} className="mt-8 flex h-14 items-center gap-2.5 rounded-full bg-ink px-7 text-base font-extrabold text-white shadow-[var(--shadow-float)] active:scale-95 disabled:opacity-60">
            <ScanFace className="size-6 text-lime" />{busy ? "Vérification…" : `Déverrouiller avec ${biometricLabel()}`}
          </button>
          <p className="mt-2 min-h-5 text-sm font-bold text-err">{err}</p>
          <button onClick={() => { setErr(null); setUsePin(true); }} className="mt-2 text-sm font-bold text-ink/70 underline underline-offset-4">Utiliser mon code PIN</button>
        </>
      ) : (
        <div className="mt-6 w-full max-w-xs rounded-[28px] bg-card p-5 shadow-[var(--shadow-float)]">
          <PinPad onComplete={pin} error={err} busy={busy} label="Votre code PIN" />
          <button onClick={() => { setErr(null); setUsePin(false); }} className="mt-4 text-sm font-bold text-muted">Revenir à {biometricLabel()}</button>
        </div>
      )}
      <button onClick={logout} className="mt-8 text-sm font-bold text-ink/60">Se déconnecter</button>
    </div>
  );
}
