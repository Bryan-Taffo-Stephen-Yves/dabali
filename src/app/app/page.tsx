"use client";
import { Bitmoji } from "@/components/bitmoji";
import { InstallApp } from "@/components/install-app";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Plus, Send, UtensilsCrossed, Sparkles, ChevronRight, Eye, EyeOff, Copy, Gift } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useAppData } from "@/components/app/app-data";
import { OccupancyCard } from "@/components/app/occupancy-card";
import { TicketRow } from "@/components/app/ticket-row";
import { NextMenu } from "@/components/app/next-menu";
import { cachedTickets, displayStatus, fetchMyTickets, syncTokens } from "@/lib/tickets";
import { fcfa, firstName, dayLong, todayISO } from "@/lib/format";
import type { Ticket } from "@/lib/types";

function greeting() {
  const h = new Date().getUTCHours(); // Abidjan = UTC+0 (« 17 h » en français n'est pas un nombre)
  return h < 12 ? "Bonne matinée" : h < 18 ? "Bon après-midi" : "Bonne soirée";
}

export default function HomePage() {
  const { profile, balance, unread } = useAppData();
  const toast = useToast();
  // Solde masquable (préférence gardée sur le téléphone)
  const [hidden, setHidden] = useState(false);
  useEffect(() => { try { setHidden(localStorage.getItem("dabali:hide-balance") === "1"); } catch {} }, []);
  const toggleHidden = () => setHidden((h) => { try { localStorage.setItem("dabali:hide-balance", h ? "0" : "1"); } catch {} return !h; });
  const copyCode = async () => {
    if (!profile?.short_code) return;
    try { await navigator.clipboard.writeText(profile.short_code); toast("ok", `Identifiant ${profile.short_code} copié`); } catch { toast("ok", `Votre identifiant : ${profile.short_code}`); }
  };
  // Barre d'état du navigateur en lime sur l'accueil (le bandeau monte jusqu'en haut)
  useEffect(() => {
    const m = document.querySelector('meta[name="theme-color"]');
    const before = m?.getAttribute("content");
    m?.setAttribute("content", "#C8F135");
    return () => { if (m && before) m.setAttribute("content", before); };
  }, []);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);

  useEffect(() => {
    setTickets(cachedTickets());
    fetchMyTickets(30).then((l) => { setTickets(l); syncTokens(); });
  }, []);

  const valid = (tickets?.filter((t) => displayStatus(t) === "valid") ?? []).sort((a, b) => a.valid_until.localeCompare(b.valid_until));
  // Plat préféré : le plus servi parmi ses derniers repas
  const favorite = (() => {
    const n = new Map<string, number>();
    tickets?.forEach((t) => t.status === "used" && t.dish?.name && n.set(t.dish.name, (n.get(t.dish.name) ?? 0) + 1));
    const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 2 ? best[0] : null;
  })();
  const points = profile?.points ?? 0;
  const rewardReady = points >= 10;

  return (
    <main>
      {/* Haut de l'accueil : bandeau lime sur toute la largeur (sous la barre d'état), solde centré, 4 actions rondes */}
      <section className="relative overflow-hidden bg-lime px-5 pb-12 pt-[max(1rem,env(safe-area-inset-top))]">
        <svg className="pointer-events-none absolute -right-16 -top-10 size-64 text-white/30" viewBox="0 0 200 200" aria-hidden>
          <circle cx="100" cy="100" r="70" fill="none" stroke="currentColor" strokeWidth="26" />
        </svg>
        <svg className="pointer-events-none absolute -bottom-24 -left-20 size-56 text-white/25" viewBox="0 0 200 200" aria-hidden>
          <circle cx="100" cy="100" r="80" fill="currentColor" />
        </svg>

        <header className="relative flex items-center gap-3 py-2">
          <Link href="/app/profil" aria-label="Mon profil" className="transition active:scale-95">
            <Bitmoji avatar={profile?.avatar} seed={profile?.id} mood={rewardReady ? "laugh" : "happy"} className="size-12 ring-[3px] ring-white" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[20px] font-extrabold leading-tight tracking-tight">Bonjour {firstName(profile?.full_name) || "👋"}</h1>
            <p className="text-[13px] font-semibold text-ink/65">{greeting()} · {dayLong(todayISO())}</p>
          </div>
          <Link href="/app/notifications" aria-label="Notifications" className="relative grid size-11 place-items-center rounded-full bg-white/55 backdrop-blur transition active:scale-95">
            <Bell className="size-5" />
            {unread > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-err px-1 text-[10px] font-bold leading-4 text-white ring-2 ring-lime">{unread > 9 ? "9+" : unread}</span>}
          </Link>
        </header>

        <div className="relative mt-5 flex flex-col items-center text-center">
          <button onClick={toggleHidden} className="flex items-center gap-1.5 text-sm font-bold text-ink/70" aria-label={hidden ? "Afficher le solde" : "Masquer le solde"}>
            Solde disponible {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
          <p className="mt-1 text-[44px] font-extrabold leading-tight tracking-tight">
            {balance === null ? <span className="inline-block h-12 w-52 animate-pulse rounded-xl bg-ink/10" />
              : hidden ? "•••••" : <>{fcfa(balance, false)}<span className="ml-1.5 text-2xl font-extrabold text-ink/60">FCFA</span></>}
          </p>
          <button onClick={copyCode} className="mt-2 flex items-center gap-1.5 rounded-full bg-white/55 px-3 py-1.5 text-[13px] font-bold text-ink/80 backdrop-blur transition active:scale-95">
            Identifiant {profile?.short_code ?? "DB-…"} <Copy className="size-3.5" />
          </button>
        </div>

        <div className="relative mt-6 grid grid-cols-4 gap-2">
          {[
            { href: "/app/recharger", label: "Recharger", icon: Plus },
            { href: "/app/transferer", label: "Transférer", icon: Send },
            { href: "/app/acheter", label: "Acheter", icon: UtensilsCrossed },
            { href: "/app/acheter?offrir=1", label: "Offrir", icon: Gift },
          ].map(({ href, label, icon: I }) => (
            <Link key={label} href={href} className="flex flex-col items-center gap-2 transition active:scale-95">
              <span className="grid size-[60px] place-items-center rounded-full bg-ink shadow-[0_8px_20px_rgb(22_24_29/0.25)]">
                <I className="size-6 text-lime" strokeWidth={2.4} />
              </span>
              <span className="text-[13px] font-bold">{label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Le reste de la page remonte sur le bandeau, coins arrondis */}
      <div className="relative -mt-7 rounded-t-[32px] bg-canvas px-4 pt-5">
      <InstallApp />

      {/* Fidélité */}
      <Link href="/app/profil#fidelite" className="mt-3 flex items-center gap-3 rounded-[22px] bg-card p-3.5 shadow-[var(--shadow-card)]">
        <span className="grid size-10 place-items-center rounded-xl bg-lime-soft"><Sparkles className="size-5 text-lime-deep" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{rewardReady ? `Petit-déjeuner offert disponible${points >= 20 ? ` × ${Math.floor(points / 10)}` : ""} 🎉` : `${points} / 10 points`}</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-canvas">
            <div className="h-full rounded-full bg-lime-deep transition-all duration-700" style={{ width: `${rewardReady ? 100 : points * 10}%` }} />
          </div>
          {rewardReady && points % 10 > 0 && <p className="mt-1 text-xs font-semibold text-muted">+ {points % 10} / 10 vers le suivant</p>}
        </div>
        <ChevronRight className="size-5 text-off" />
      </Link>

      {/* Tickets valides seulement : les expirés et utilisés restent dans « Mes tickets » */}
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-extrabold">Mes tickets</h2>
          <Link href="/app/tickets" className="text-sm font-bold text-muted">Tout voir</Link>
        </div>
        {tickets === null ? (
          <div className="h-[88px] animate-pulse rounded-[20px] bg-card" />
        ) : valid.length === 0 ? (
          <EmptyTickets avatar={profile?.avatar} seed={profile?.id} />
        ) : (
          <div className="space-y-3">{valid.map((t) => <TicketRow key={t.id} t={t} />)}</div>
        )}
      </section>

      <div className="mt-6"><NextMenu favorite={favorite} /></div>

      <section className="mt-6">
        <h2 className="mb-3 text-[17px] font-extrabold">Affluence</h2>
        <OccupancyCard />
      </section>
      </div>
    </main>
  );
}

function EmptyTickets({ avatar, seed }: { avatar?: string | null; seed?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[20px] border-2 border-dashed border-line p-4">
      <Bitmoji avatar={avatar} seed={seed} mood="yum" className="size-12" />
      <div className="flex-1">
        <p className="font-bold">Aucun ticket valide</p>
        <p className="text-sm text-muted">Achetez vos tickets, évitez la file.</p>
      </div>
      <Link href="/app/acheter" className="rounded-full bg-ink px-4 py-2 text-sm font-bold text-white">Acheter</Link>
    </div>
  );
}
