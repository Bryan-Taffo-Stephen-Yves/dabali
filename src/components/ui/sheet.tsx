"use client";
import { useEffect } from "react";
import { X } from "lucide-react";

/** Panneau qui monte du bas de l'écran (mobile) */
export function Sheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title?: string; children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Fermer" className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-rise relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" />
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-extrabold">{title}</h2>
            <button onClick={onClose} aria-label="Fermer" className="grid size-9 place-items-center rounded-full bg-canvas">
              <X className="size-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
