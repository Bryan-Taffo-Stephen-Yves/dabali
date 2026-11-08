"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Smartphone, KeyRound, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { homeFor } from "@/lib/roles";

type Step =
  | { kind: "loading" }
  | { kind: "intro" }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "verify"; factorId: string }
  | { kind: "done"; factorId: string };

/**
 * Double authentification (TOTP) : un code à 6 chiffres de Google Authenticator, Authy, Microsoft Authenticator…
 * 1re fois : on scanne le QR avec l'application ; ensuite : on saisit le code à chaque connexion.
 */
export default function MfaPage() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState<string | null>(null);

  const start = useCallback(async () => {
    const sb = supabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return router.replace("/connexion");
    const [{ data: factors }, { data: aal }] = await Promise.all([sb.auth.mfa.listFactors(), sb.auth.mfa.getAuthenticatorAssuranceLevel()]);
    const verified = factors?.totp?.find((f) => f.status === "verified");
    if (verified) return setStep(aal?.currentLevel === "aal2" ? { kind: "done", factorId: verified.id } : { kind: "verify", factorId: verified.id });
    // Pas encore d'application liée : on attend que la personne clique sur « Commencer »
    setStep({ kind: "intro" });
  }, [router]);

  const enroll = useCallback(async () => {
    setStep({ kind: "loading" });
    const sb = supabase();
    const { data: factors } = await sb.auth.mfa.listFactors();
    for (const f of factors?.all ?? []) if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Dabali ${new Date().toISOString().slice(0, 10)}` });
    if (error || !data) { toast("err", "Activation impossible pour le moment."); return; }
    setStep({ kind: "enroll", factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }, [toast]);

  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("next");
    if (n?.startsWith("/") && !n.startsWith("//")) setNext(n);
    start();
  }, [start]);

  async function verify() {
    if (step.kind !== "enroll" && step.kind !== "verify") return;
    setBusy(true);
    const sb = supabase();
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: step.factorId, code: code.trim() });
    setBusy(false);
    if (error) { setCode(""); return toast("err", "Code incorrect ou expiré. Réessayez avec le code affiché maintenant."); }
    toast("ok", step.kind === "enroll" ? "Double authentification activée." : "Identité confirmée.");
    const { data: { user } } = await sb.auth.getUser();
    const { data: p } = await sb.from("profiles").select("role").eq("id", user!.id).single();
    router.replace(next ?? homeFor(p?.role));
    router.refresh();
  }

  async function reset() {
    if (step.kind !== "done" || !confirm("Changer de téléphone ? L'ancienne application ne fonctionnera plus.")) return;
    await supabase().auth.mfa.unenroll({ factorId: step.factorId });
    await supabase().auth.refreshSession();
    setStep({ kind: "loading" });
    start();
  }

  return (
    <div className="mt-8">
      <span className="grid size-14 place-items-center rounded-2xl bg-ink text-lime"><ShieldCheck className="size-7" /></span>
      <h1 className="mt-4 text-[28px] font-extrabold leading-tight">Double authentification</h1>

      {step.kind === "loading" && <div className="mt-6 h-64 animate-pulse rounded-[24px] bg-card" />}

      {step.kind === "intro" && (
        <>
          <p className="mt-2 text-ink-2">Protégez votre compte : en plus du mot de passe, un code à 6 chiffres de votre téléphone sera demandé à chaque connexion.</p>
          <p className="mt-3 text-sm text-muted">Il vous faut une application gratuite : Google Authenticator, Microsoft Authenticator ou Authy.</p>
          <Button block size="lg" variant="dark" className="mt-6" onClick={enroll}>Commencer</Button>
          <button onClick={() => router.replace(next ?? "/")} className="mt-4 w-full text-center text-sm font-bold text-muted">Plus tard</button>
        </>
      )}

      {step.kind === "enroll" && (
        <>
          <p className="mt-2 text-ink-2">Votre compte gère de l&apos;argent ou l&apos;équipe : un code de votre téléphone est demandé en plus du mot de passe.</p>
          <ol className="mt-5 space-y-4">
            <li className="rounded-[22px] bg-card p-4 shadow-[var(--shadow-card)]">
              <p className="flex items-center gap-2 font-bold"><Smartphone className="size-4" />1. Installez une application de codes</p>
              <p className="mt-1 text-sm text-muted">Google Authenticator, Microsoft Authenticator ou Authy (gratuites).</p>
            </li>
            <li className="rounded-[22px] bg-card p-4 text-center shadow-[var(--shadow-card)]">
              <p className="text-left font-bold">2. Scannez ce QR avec l&apos;application</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={step.qr} alt="QR à scanner avec l'application d'authentification" className="mx-auto mt-3 size-48 rounded-xl bg-white p-2" />
              <p className="mt-2 text-xs text-muted">Pas de caméra ? Saisissez cette clé : <span className="select-all break-all font-mono font-bold text-ink">{step.secret}</span></p>
            </li>
            <li className="rounded-[22px] bg-card p-4 shadow-[var(--shadow-card)]">
              <p className="flex items-center gap-2 font-bold"><KeyRound className="size-4" />3. Entrez le code à 6 chiffres affiché</p>
              <CodeInput value={code} onChange={setCode} onEnter={verify} />
            </li>
          </ol>
          <Button block size="lg" variant="dark" className="mt-5" loading={busy} disabled={code.length !== 6} onClick={verify}>Activer</Button>
        </>
      )}

      {step.kind === "verify" && (
        <>
          <p className="mt-2 text-ink-2">Ouvrez votre application d&apos;authentification et entrez le code à 6 chiffres pour <b>Dabali</b>.</p>
          <div className="mt-5 rounded-[22px] bg-card p-4 shadow-[var(--shadow-card)]"><CodeInput value={code} onChange={setCode} onEnter={verify} /></div>
          <Button block size="lg" variant="dark" className="mt-5" loading={busy} disabled={code.length !== 6} onClick={verify}>Valider</Button>
          <button onClick={async () => { await supabase().auth.signOut(); router.replace("/connexion"); }} className="mt-4 w-full text-center text-sm font-bold text-muted">Se déconnecter</button>
        </>
      )}

      {step.kind === "done" && (
        <>
          <p className="mt-2 text-ink-2">La double authentification est <b className="text-[#15803d]">activée</b> sur ce compte. Le code de votre application est demandé à chaque connexion.</p>
          <Button block size="lg" variant="dark" className="mt-6" onClick={() => router.replace(next ?? "/")}>Continuer</Button>
          <button onClick={reset} className="mt-4 flex w-full items-center justify-center gap-1.5 text-sm font-bold text-muted"><RotateCcw className="size-4" />Changer de téléphone</button>
        </>
      )}
    </div>
  );
}

function CodeInput({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))} onKeyDown={(e) => e.key === "Enter" && value.length === 6 && onEnter()}
      inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="000000" aria-label="Code à 6 chiffres"
      className="mt-3 h-14 w-full rounded-2xl border border-line bg-canvas text-center font-mono text-3xl font-extrabold tracking-[0.4em] outline-none focus:border-ink" />
  );
}
