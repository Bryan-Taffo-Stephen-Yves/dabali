"use client";
import { InstallApp } from "@/components/install-app";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Plus, Send, UtensilsCrossed, Sparkles, ChevronRight } from "lucide-react";
import { useAppData } from "@/components/app/app-data";
import { OccupancyCard } from "@/components/app/occupancy-card";
import { TicketRow } from "@/components/app/ticket-row";
import { NextMenu } from "@/components/app/next-menu";
import { cachedTickets, displayStatus, fetchMyTickets, syncTokens } from "@/lib/tickets";
import { fcfa, firstName, dayLong, todayISO } from "@/lib/format";
import type { Ticket } from "@/lib/types";

export default function HomePage() {
  const { profile, balance, unread } = useAppData();
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
    <main className="px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between py-2">
        <div>
          <p className="text-[13px] font-semibold text-muted">{dayLong(todayISO())}</p>
          <h1 className="text-[22px] font-extrabold tracking-tight">Bonjour {firstName(profile?.full_name) || "👋"}</h1>
        </div>
        <Link href="/app/notifications" aria-label="Notifications" className="relative grid size-11 place-items-center rounded-full bg-card shadow-[var(--shadow-card)]">
          <Bell className="size-5" />
          {unread > 0 && <span className="absolute right-2 top-2 grid min-w-4 place-items-center rounded-full bg-err px-1 text-[10px] font-bold leading-4 text-white">{unread > 9 ? "9+" : unread}</span>}
        </Link>
      </header>

      {/* Solde */}
      <section className="relative mt-3 overflow-hidden rounded-[28px] bg-lime p-5 pb-4">
        <svg className="pointer-events-none absolute -right-10 -top-12 size-52 text-white/30" viewBox="0 0 200 200" aria-hidden>
          <circle cx="100" cy="100" r="70" fill="none" stroke="currentColor" strokeWidth="26" />
        </svg>
        <div className="relative flex items-start justify-between">
          <p className="text-sm font-bold text-ink/70">Solde disponible</p>
          <span className="rounded-full bg-ink/10 px-2.5 py-1 text-xs font-bold">{profile?.short_code ?? "DB-…"}</span>
        </div>
        <p className="relative mt-1 text-[40px] font-extrabold leading-tight tracking-tight">
          {balance === null ? <span className="inline-block h-10 w-44 animate-pulse rounded-xl bg-ink/10" /> : fcfa(balance)}
        </p>
        <div className="relative mt-4 grid grid-cols-3 gap-2">
          {[
            { href: "/app/recharger", label: "Recharger", icon: Plus },
            { href: "/app/transferer", label: "Transférer", icon: Send },
            { href: "/app/acheter", label: "Acheter", icon: UtensilsCrossed },
          ].map(({ href, label, icon: I }) => (
            <Link key={href} href={href} className="flex flex-col items-center gap-1.5 rounded-2xl bg-ink py-3 text-white transition active:scale-95">
              <I className="size-5 text-lime" strokeWidth={2.4} />
              <span className="text-[12px] font-bold">{label}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-3"><InstallApp /></div>

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
          <EmptyTickets />
        ) : (
          <div className="space-y-3">{valid.map((t) => <TicketRow key={t.id} t={t} />)}</div>
        )}
      </section>

      <div className="mt-6"><NextMenu favorite={favorite} /></div>

      <section className="mt-6">
        <h2 className="mb-3 text-[17px] font-extrabold">Affluence</h2>
        <OccupancyCard />
      </section>
    </main>
  );
}

function EmptyTickets() {
  return (
    <div className="flex items-center gap-3 rounded-[20px] border-2 border-dashed border-line p-4">
      <span className="grid size-12 place-items-center rounded-2xl bg-card"><UtensilsCrossed className="size-5 text-muted" /></span>
      <div className="flex-1">
        <p className="font-bold">Aucun ticket valide</p>
        <p className="text-sm text-muted">Achetez vos tickets, évitez la file.</p>
      </div>
      <Link href="/app/acheter" className="rounded-full bg-ink px-4 py-2 text-sm font-bold text-white">Acheter</Link>
    </div>
  );
}
