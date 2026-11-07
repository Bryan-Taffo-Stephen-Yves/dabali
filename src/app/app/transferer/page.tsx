"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, UserRound, ChevronRight } from "lucide-react";
import { rpc } from "@/lib/supabase/client";
import { PageHeader } from "@/components/app/page-header";
import { RecipientSheet, type Recipient } from "@/components/app/recipient-sheet";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { PinPad } from "@/components/ui/pin-pad";
import { useToast } from "@/components/ui/toast";
import { useAppData } from "@/components/app/app-data";
import { fcfa } from "@/lib/format";

export default function TransferPage() {
  const router = useRouter();
  const toast = useToast();
  const { balance, refresh } = useAppData();
  const [to, setTo] = useState<Recipient | null>(null);
  const [pick, setPick] = useState(true);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = parseInt(amount || "0", 10);

  async function send(pin: string) {
    if (!to) return;
    setBusy(true);
    const r = await rpc<{ balance: number }>("transfer_funds", { p_recipient_id: to.id, p_amount: value, p_pin: pin, p_note: note || null });
    setBusy(false);
    if (!r.ok) {
      if (r.code.startsWith("PIN")) return setPinError(r.message);
      setPinOpen(false);
      return toast("err", r.message);
    }
    setPinOpen(false);
    await refresh();
    toast("ok", `${fcfa(value)} envoyés à ${to.full_name.split(" ")[0]}.`);
    router.replace("/app");
  }

  return (
    <main>
      <PageHeader title="Transférer" />
      <div className="px-4">
        <button onClick={() => setPick(true)} className="flex w-full items-center gap-3 rounded-[22px] bg-card p-4 text-left shadow-[var(--shadow-card)]">
          <span className="grid size-12 place-items-center rounded-2xl bg-lime"><UserRound className="size-6" /></span>
          <span className="flex-1">
            <span className="block text-xs font-bold text-muted">Destinataire</span>
            <span className="block text-[17px] font-extrabold">{to ? to.full_name : "Choisir…"}</span>
            {to?.short_code && <span className="text-xs font-semibold text-muted">{to.short_code}</span>}
          </span>
          <ChevronRight className="size-5 text-off" />
        </button>

        <div className="mt-4 rounded-[26px] bg-card p-5 text-center shadow-[var(--shadow-card)]">
          <p className="text-sm font-bold text-muted">Montant</p>
          <input inputMode="numeric" value={amount} placeholder="0" aria-label="Montant"
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="mt-1 w-full bg-transparent text-center text-[42px] font-extrabold tracking-tight outline-none placeholder:text-line" />
          <p className="text-sm font-bold text-muted">FCFA · solde {fcfa(balance ?? 0)}</p>
          <div className="mt-4 flex justify-center gap-2">
            {[500, 1000, 2500, 5000].map((a) => (
              <button key={a} onClick={() => setAmount(String(a))} className="h-9 rounded-full bg-canvas px-3.5 text-sm font-bold active:bg-line">{fcfa(a, false)}</button>
            ))}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 80))} placeholder="Message (facultatif)"
            className="mt-4 h-11 w-full rounded-2xl border border-line px-4 text-[15px] outline-none focus:border-ink" />
        </div>
        <p className="mt-3 text-center text-xs font-semibold text-muted">Min. 100 FCFA · max. 50 000 FCFA par envoi · 100 000 FCFA par jour</p>

        <Button size="lg" variant="dark" block className="mt-6" disabled={!to || value < 100 || value > (balance ?? 0)}
          onClick={() => { setPinError(null); setPinOpen(true); }}>
          <Send className="size-5 text-lime" /> Envoyer {value > 0 ? fcfa(value) : ""}
        </Button>
      </div>

      <RecipientSheet title="Envoyer à" open={pick} onClose={() => setPick(false)} onPick={(u) => { setTo(u); setPick(false); }} />
      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Confirmer le transfert">
        <p className="-mt-2 mb-4 text-sm text-muted">{fcfa(value)} → <b className="text-ink">{to?.full_name}</b></p>
        <PinPad onComplete={send} error={pinError} busy={busy} />
      </Sheet>
    </main>
  );
}
