"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, Search, ShieldAlert, X } from "lucide-react";
import { rpc } from "@/lib/supabase/client";
import { PinPad } from "@/components/ui/pin-pad";
import { SERVICE_LABEL } from "@/lib/format";
import type { ServiceKind } from "@/lib/types";

type Hit = { short_code: string; full_name: string; has_pin: boolean; locked: boolean; tickets: number };

/**
 * Client sans téléphone (éteint, perdu, oublié) : l'agent le retrouve par son nom ou son code Dabali,
 * puis le CLIENT tape son code PIN sur ce téléphone. Le ticket est validé comme un scan.
 */
export function NoPhoneSheet({ service, date, onClose, onSuccess }: {
  service: ServiceKind; date: string; onClose: () => void; onSuccess: (r: Record<string, unknown>) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [who, setWho] = useState<Hit | null>(null);
  const [lost, setLost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 3) { setHits(null); return; }
    const id = setTimeout(async () => {
      const r = await rpc<{ results: Hit[] }>("counter_lookup", { p_query: q, p_service: service });
      setHits(r.ok ? r.results : []);
    }, 300);
    return () => clearTimeout(id);
  }, [q, service]);

  const onPin = useCallback(async (pin: string) => {
    if (!who || busy) return;
    setBusy(true); setErr(null);
    const r = await rpc<Record<string, unknown>>("redeem_with_pin", {
      p_short_code: who.short_code, p_pin: pin, p_service_date: date, p_service: service, p_lost_phone: lost,
    });
    setBusy(false);
    if (r.ok) return onSuccess(r as Record<string, unknown>);
    const f = r as unknown as { code: string; message: string; attempts_left?: number };
    if (f.code === "PIN_INVALID") return setErr(`Code incorrect · ${f.attempts_left} essai${(f.attempts_left ?? 0) > 1 ? "s" : ""} restant${(f.attempts_left ?? 0) > 1 ? "s" : ""}`);
    setBlocked(f.message); // bloqué, plus de ticket, scanner limité… : on n'insiste pas
  }, [who, busy, date, service, lost, onSuccess]);

  const label = SERVICE_LABEL[service];
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/60" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Client sans téléphone"
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink">
        <div className="flex items-center gap-2">
          {who && <button onClick={() => { setWho(null); setErr(null); setBlocked(null); }} aria-label="Retour" className="grid size-9 place-items-center rounded-full bg-canvas"><ArrowLeft className="size-4" /></button>}
          <p className="flex-1 text-lg font-extrabold">Client sans téléphone</p>
          <button onClick={onClose} aria-label="Fermer" className="grid size-9 place-items-center rounded-full bg-canvas"><X className="size-4" /></button>
        </div>

        {!who ? (
          <>
            <p className="mt-1 text-sm text-muted">Demandez son nom ou son code Dabali (DB-…). Ticket <b>{label}</b>.</p>
            <label className="mt-4 flex h-12 items-center gap-2 rounded-2xl border border-line bg-canvas px-3 focus-within:border-ink">
              <Search className="size-4 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Nom ou code (ex. 4821)"
                className="h-full flex-1 bg-transparent text-base font-semibold outline-none" />
            </label>
            <div className="mt-3 min-h-40 space-y-2">
              {hits === null && <p className="py-8 text-center text-sm text-muted">3 caractères minimum</p>}
              {hits?.length === 0 && <p className="py-8 text-center text-sm text-muted">Aucun client trouvé</p>}
              {hits?.map((h) => {
                const why = !h.has_pin ? "Pas de code PIN : QR obligatoire" : h.locked ? "Code PIN bloqué (trop d'essais)" : h.tickets === 0 ? `Aucun ticket ${label}` : null;
                return (
                  <button key={h.short_code} disabled={!!why} onClick={() => { setWho(h); setErr(null); setBlocked(null); setLost(false); }}
                    className="flex w-full items-center gap-3 rounded-2xl bg-canvas p-3 text-left transition active:scale-[0.98] disabled:opacity-60">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-lime text-sm font-extrabold">
                      {h.full_name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{h.full_name}</span>
                      <span className="block text-xs font-semibold text-muted">{h.short_code}</span>
                    </span>
                    <span className={clsx("shrink-0 rounded-full px-2.5 py-1 text-xs font-bold", why ? "bg-err-soft text-err" : "bg-ink text-lime")}>
                      {why ?? `${h.tickets} ticket${h.tickets > 1 ? "s" : ""}`}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 flex gap-2 rounded-2xl bg-canvas p-3 text-xs text-muted">
              <ShieldAlert className="size-4 shrink-0" />En cas de doute sur l&apos;identité, demandez la carte d&apos;étudiant. Le client est prévenu à chaque repas validé sans QR.
            </p>
          </>
        ) : (
          <>
            <div className="mt-3 flex items-center gap-3 rounded-2xl bg-canvas p-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-lime font-extrabold">{who.full_name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
              <div className="min-w-0">
                <p className="truncate text-lg font-extrabold">{who.full_name}</p>
                <p className="text-sm font-semibold text-muted">{who.short_code} · {who.tickets} ticket{who.tickets > 1 ? "s" : ""} {label}</p>
              </div>
            </div>
            {blocked ? (
              <div className="mt-4 rounded-2xl bg-err-soft p-4 text-center">
                <p className="font-bold text-err">{blocked}</p>
                <button onClick={onClose} className="mt-3 h-11 w-full rounded-full bg-ink font-bold text-white">Fermer</button>
              </div>
            ) : (
              <>
                <p className="mt-4 text-center text-sm font-bold">Tendez le téléphone au client : <span className="text-[#15803d]">lui seul</span> tape son code PIN.</p>
                <label className="mt-3 flex items-start gap-3 rounded-2xl border border-line p-3 text-sm">
                  <input type="checkbox" checked={lost} onChange={(e) => setLost(e.target.checked)} className="mt-0.5 size-5 accent-[#0b0b0b]" />
                  <span><b>Téléphone perdu ou volé</b><span className="block text-xs text-muted">Ses anciens QR ne marcheront plus et l&apos;ancien téléphone sera déconnecté.</span></span>
                </label>
                <div className="mt-4"><PinPad onComplete={onPin} error={err} busy={busy} label="Code PIN du client" /></div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
