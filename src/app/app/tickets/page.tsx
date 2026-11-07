"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { QrCode, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { TicketRow } from "@/components/app/ticket-row";
import { Qr } from "@/components/qr";
import { cachedTickets, cachedToken, displayStatus, fetchMyTickets, syncTokens } from "@/lib/tickets";
import { SERVICE_LABEL, relativeDay, time } from "@/lib/format";
import type { Ticket } from "@/lib/types";

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [tab, setTab] = useState<"next" | "past">("next");
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const c = cachedTickets();
    if (c.length) setTickets(c);
    fetchMyTickets(80).then(setTickets);
    syncTokens().then(() => setTickets((l) => l));
  }, []);

  const valid = (tickets ?? []).filter((t) => displayStatus(t) === "valid");
  const past = (tickets ?? []).filter((t) => displayStatus(t) !== "valid");
  const next = valid[0];

  useEffect(() => { if (next) setToken(cachedToken(next.id)); }, [next, tickets]);

  return (
    <main>
      <PageHeader title="Mes tickets" back={false} />
      <div className="px-4">
        {next && (
          <Link href={`/app/tickets/${next.id}`} className="mb-5 flex items-center gap-4 rounded-[26px] bg-ink p-4 text-white transition active:scale-[0.99]">
            <div className="w-[92px] shrink-0 rounded-2xl bg-white p-1.5">
              {token ? <Qr value={token} size={120} /> : <div className="grid aspect-square place-items-center"><QrCode className="size-10 text-ink" /></div>}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-lime">Prochain repas</p>
              <p className="mt-1 truncate text-lg font-extrabold">{next.dish.name}</p>
              <p className="text-sm text-white/70">{relativeDay(next.service_date)} · {SERVICE_LABEL[next.service]} · {time(next.valid_from)}</p>
              <p className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-lime">Afficher le QR <ChevronRight className="size-4" /></p>
            </div>
          </Link>
        )}

        <div className="mb-4 grid grid-cols-2 gap-1 rounded-full bg-card p-1 shadow-[var(--shadow-card)]">
          {([["next", `À venir (${valid.length})`], ["past", "Passés"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={clsx("h-10 rounded-full text-sm font-bold transition", tab === k ? "bg-lime" : "text-muted")}>{l}</button>
          ))}
        </div>

        <div className="space-y-3">
          {tickets === null && [0, 1, 2].map((i) => <div key={i} className="h-[88px] animate-pulse rounded-[20px] bg-card" />)}
          {(tab === "next" ? valid : past).map((t) => <TicketRow key={t.id} t={t} />)}
          {tickets !== null && (tab === "next" ? valid : past).length === 0 && (
            <div className="rounded-[24px] border-2 border-dashed border-line p-8 text-center">
              <p className="font-bold">{tab === "next" ? "Aucun ticket à venir" : "Aucun ticket passé"}</p>
              {tab === "next" && <Link href="/app/menu" className="mt-3 inline-block rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white">Voir le menu</Link>}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
