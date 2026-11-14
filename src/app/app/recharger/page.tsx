"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Smartphone, Banknote, Info } from "lucide-react";
import { rpc } from "@/lib/supabase/client";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAppData } from "@/components/app/app-data";
import { Sheet } from "@/components/ui/sheet";
import { BiometricConfirm } from "@/components/app/biometric-confirm";
import { fcfa } from "@/lib/format";

const AMOUNTS = [2000, 5000, 10000, 25000, 50000, 100000];
const OPERATORS = [
  { id: "wave", name: "Wave", color: "#1DC3FF" },
  { id: "orange", name: "Orange Money", color: "#FF7900" },
  { id: "mtn", name: "MTN MoMo", color: "#FFCB05" },
  { id: "moov", name: "Moov Money", color: "#0066B3" },
];

export default function RechargePage() {
  const router = useRouter();
  const toast = useToast();
  const { balance, profile, refresh } = useAppData();
  const [amount, setAmount] = useState(5000);
  const [custom, setCustom] = useState("");
  const [op, setOp] = useState("wave");
  const [busy, setBusy] = useState(false);
  const value = custom ? parseInt(custom.replace(/\D/g, ""), 10) || 0 : amount;

  // Face ID activé : confirmation avant la recharge (la base refuse sinon)
  const [confirmOpen, setConfirmOpen] = useState(false);
  const start = () => (profile?.biometric_enabled ? setConfirmOpen(true) : pay());

  async function pay() {
    setConfirmOpen(false);
    setBusy(true);
    const r = await rpc<{ balance: number }>("simulate_recharge", { p_amount: value });
    setBusy(false);
    if (!r.ok) return toast("err", r.message);
    await refresh();
    toast("ok", `${fcfa(value)} ajoutés. Nouveau solde : ${fcfa(r.balance)}`);
    router.replace("/app");
  }

  return (
    <main>
      <PageHeader title="Recharger" />
      <div className="px-4">
        <p className="text-sm font-semibold text-muted">Solde actuel · <b className="text-ink">{fcfa(balance ?? 0)}</b></p>

        <div className="mt-5 rounded-[26px] bg-card p-5 text-center shadow-[var(--shadow-card)]">
          <p className="text-sm font-bold text-muted">Montant</p>
          <p className="mt-1 text-[42px] font-extrabold tracking-tight">{fcfa(value)}</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {AMOUNTS.map((a) => (
              <button key={a} onClick={() => { setAmount(a); setCustom(""); }}
                className={clsx("h-12 rounded-2xl text-[15px] font-extrabold transition",
                  !custom && amount === a ? "bg-ink text-lime" : "bg-canvas text-ink active:bg-line")}>
                {fcfa(a, false)}
              </button>
            ))}
          </div>
          <input inputMode="numeric" placeholder="Autre montant" value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="mt-3 h-12 w-full rounded-2xl border border-line bg-card px-4 text-center text-[16px] font-bold outline-none focus:border-ink" />
        </div>

        <h2 className="mb-2.5 mt-6 text-[15px] font-extrabold">Payer avec</h2>
        <div className="grid grid-cols-2 gap-2">
          {OPERATORS.map((o) => (
            <button key={o.id} onClick={() => setOp(o.id)}
              className={clsx("flex h-14 items-center gap-2.5 rounded-2xl border-2 bg-card px-3 text-left text-sm font-bold transition",
                op === o.id ? "border-ink" : "border-transparent shadow-[var(--shadow-card)]")}>
              <span className="grid size-8 place-items-center rounded-xl text-white" style={{ background: o.color }}><Smartphone className="size-4" /></span>
              {o.name}
            </button>
          ))}
        </div>

        <p className="mt-4 flex gap-2 rounded-2xl bg-warn-soft p-3 text-[13px] font-semibold text-[#92400e]">
          <Info className="mt-0.5 size-4 shrink-0" />
          Mobile Money (simulation) : aucun débit réel pendant la démo.
        </p>
        <p className="mt-2 flex gap-2 rounded-2xl bg-card p-3 text-[13px] font-semibold text-ink-2 shadow-[var(--shadow-card)]">
          <Banknote className="mt-0.5 size-4 shrink-0" />
          <span>En espèces : présentez votre identifiant <b className="whitespace-nowrap">{profile?.short_code}</b> à la caisse.</span>
        </p>

        <Button size="lg" block className="mt-6" loading={busy} disabled={value < 100 || value > 500000} onClick={start}>
          Recharger {fcfa(value)}
        </Button>
      </div>
      <Sheet open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirmer la recharge">
        <p className="-mt-2 mb-5 text-sm text-muted">Recharge de <b className="text-ink">{fcfa(value)}</b></p>
        <BiometricConfirm enabled mode="grant" onConfirmed={() => pay()} busy={busy} />
      </Sheet>
    </main>
  );
}
