"use client";
import { useCallback, useEffect, useState } from "react";
import { ScanFace } from "lucide-react";
import { PinPad } from "@/components/ui/pin-pad";
import { biometricLabel, confirmBiometric, confirmWithPin, prepareBiometric } from "@/lib/biometric";

/**
 * Confirmation d'une opération d'argent : Face ID (ou empreinte) d'abord si activé, code PIN en secours.
 * mode « send » : le PIN est rendu tel quel à l'appelant (transfert, achat) ; « grant » : le PIN est vérifié ici (recharge).
 * Face ID réussi → onConfirmed("BIOMETRIC").
 */
export function BiometricConfirm({ enabled, mode, onConfirmed, pinError, busy }: {
  enabled: boolean; mode: "send" | "grant"; onConfirmed: (pin: string) => void; pinError?: string | null; busy?: boolean;
}) {
  const [usePin, setUsePin] = useState(!enabled);
  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  useEffect(() => { if (enabled) void prepareBiometric(); }, [enabled]);

  const face = async () => {
    setErr(null); setWorking(true);
    const r = await confirmBiometric();
    setWorking(false);
    if (r.ok) return onConfirmed("BIOMETRIC");
    setErr(r.message);
  };
  const pin = useCallback(async (p: string) => {
    if (mode === "send") return onConfirmed(p);
    setWorking(true);
    const r = await confirmWithPin(p);
    setWorking(false);
    if (r.ok) onConfirmed("BIOMETRIC"); else setErr(r.message);
  }, [mode, onConfirmed]);

  if (!usePin) {
    return (
      <div className="flex flex-col items-center pb-2 text-center">
        <button onClick={face} disabled={working || busy}
          className="grid size-28 place-items-center rounded-full bg-ink text-lime shadow-[var(--shadow-float)] transition active:scale-95 disabled:opacity-60">
          <ScanFace className="size-14" strokeWidth={1.6} />
        </button>
        <p className="mt-4 text-lg font-extrabold">{working ? "Vérification…" : `Confirmer avec ${biometricLabel()}`}</p>
        <p className="mt-1 min-h-5 text-sm font-semibold text-err">{err}</p>
        <button onClick={() => { setErr(null); setUsePin(true); }} className="mt-3 text-sm font-bold text-muted underline underline-offset-4">Utiliser mon code PIN</button>
      </div>
    );
  }
  return (
    <div>
      <PinPad onComplete={pin} error={pinError ?? err} busy={busy || working} />
      {enabled && <button onClick={() => { setErr(null); setUsePin(false); }} className="mx-auto mt-4 flex items-center gap-1.5 text-sm font-bold text-muted"><ScanFace className="size-4" />Revenir à {biometricLabel()}</button>}
    </div>
  );
}
