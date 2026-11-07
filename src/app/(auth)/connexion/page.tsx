"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QrCode, Wallet, UtensilsCrossed } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { homeFor } from "@/lib/roles";

const DEMO = [
  { label: "Client", email: "client@dabali.ci" },
  { label: "Agent", email: "agent@dabali.ci" },
  { label: "Chef", email: "chef@dabali.ci" },
  { label: "Caisse", email: "caisse@dabali.ci" },
  { label: "Admin", email: "admin@dabali.ci" },
];

export default function ConnexionPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e?: React.FormEvent, creds?: { email: string; password: string }) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase().auth.signInWithPassword(creds ?? { email: email.trim(), password });
    if (error) {
      setBusy(false);
      setError(/invalid/i.test(error.message) ? "E-mail ou mot de passe incorrect." : "Connexion impossible. Réessayez.");
      return;
    }
    const { data: p } = await supabase().from("profiles").select("role").eq("id", data.user.id).single();
    router.replace(homeFor(p?.role));
    router.refresh();
  }

  return (
    <>
      <section className="mt-10 mb-8">
        <h1 className="text-[34px] font-extrabold leading-[1.05] tracking-tight">
          Mangez sans <span className="relative whitespace-nowrap"><span className="relative z-10">attendre.</span><span className="absolute inset-x-0 bottom-1 -z-0 h-3 rounded bg-lime" /></span>
        </h1>
        <p className="mt-3 text-[15px] text-muted">Rechargez, réservez votre plat, présentez votre QR. C&apos;est tout.</p>
        <div className="mt-6 flex gap-2">
          {[[Wallet, "Solde prépayé"], [UtensilsCrossed, "Menu illustré"], [QrCode, "Ticket QR"]].map(([Icon, t]) => {
            const I = Icon as typeof Wallet;
            return (
              <span key={t as string} className="flex flex-1 flex-col items-center gap-1.5 rounded-2xl bg-card py-3 text-[11px] font-bold text-ink-2 shadow-[var(--shadow-card)]">
                <I className="size-5" /> {t as string}
              </span>
            );
          })}
        </div>
      </section>

      <form onSubmit={signIn} className="space-y-4">
        <Field label="E-mail" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.ci" />
        <Field label="Mot de passe" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" error={error} />
        <Button type="submit" size="lg" block loading={busy}>Se connecter</Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Pas encore de compte ? <Link href="/inscription" className="font-bold text-ink underline decoration-lime decoration-[3px] underline-offset-4">Créer un compte</Link>
      </p>

      <div className="mt-auto pt-10">
        <p className="mb-2 text-center text-xs font-bold uppercase tracking-wider text-off">Comptes de démo</p>
        <div className="flex flex-wrap justify-center gap-2">
          {DEMO.map((d) => (
            <button key={d.email} type="button" disabled={busy}
              onClick={() => signIn(undefined, { email: d.email, password: "Dabali2026!" })}
              className="rounded-full border border-line bg-card px-3.5 py-2 text-xs font-bold transition hover:border-ink active:scale-95">
              {d.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
