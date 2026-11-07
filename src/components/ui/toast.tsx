"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import clsx from "clsx";

type Toast = { id: number; kind: "ok" | "err"; text: string };
const Ctx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l, { id, kind, text }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 3800);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] mx-auto flex max-w-md flex-col gap-2 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={clsx(
              "animate-rise flex items-start gap-2.5 rounded-2xl px-4 py-3 text-sm font-semibold shadow-[var(--shadow-float)]",
              t.kind === "ok" ? "bg-ink text-white" : "bg-err text-white",
            )}
          >
            {t.kind === "ok" ? <CheckCircle2 className="size-5 shrink-0 text-lime" /> : <AlertCircle className="size-5 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
