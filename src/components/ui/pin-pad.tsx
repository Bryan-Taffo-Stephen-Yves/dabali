"use client";
import { useEffect, useState } from "react";
import { Delete } from "lucide-react";
import clsx from "clsx";

/** Saisie du code PIN à 4 chiffres (clavier numérique intégré, gros boutons) */
export function PinPad({ onComplete, error, busy, label = "Entrez votre code PIN" }: {
  onComplete: (pin: string) => void; error?: string | null; busy?: boolean; label?: string;
}) {
  const [pin, setPin] = useState("");
  useEffect(() => { if (error) setPin(""); }, [error]);
  useEffect(() => { if (pin.length === 4) onComplete(pin); }, [pin, onComplete]);

  const press = (d: string) => !busy && setPin((p) => (p.length < 4 ? p + d : p));
  return (
    <div className="flex flex-col items-center">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <div className={clsx("my-5 flex gap-4", error && "animate-[shake_0.3s]")} aria-live="polite">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={clsx("size-4 rounded-full transition", i < pin.length ? "scale-110 bg-ink" : "bg-line")} />
        ))}
      </div>
      <p className="mb-3 min-h-5 text-center text-sm font-semibold text-err">{error}</p>
      <div className="grid w-full max-w-[300px] grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) =>
          k === "" ? <span key={i} /> : (
            <button
              key={i}
              type="button"
              disabled={busy}
              aria-label={k === "⌫" ? "Effacer" : k}
              onClick={() => (k === "⌫" ? setPin((p) => p.slice(0, -1)) : press(k))}
              className="grid h-16 place-items-center rounded-2xl bg-canvas text-2xl font-bold transition active:scale-95 active:bg-line disabled:opacity-50"
            >
              {k === "⌫" ? <Delete className="size-6" /> : k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
