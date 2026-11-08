"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { Download, Share, SquarePlus, X } from "lucide-react";

type Mode = "hidden" | "prompt" | "ios" | "manual";
const DISMISS = "dabali:install-dismissed";

function detect(): Mode {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (standalone) return "hidden";                                   // déjà installée, ouverte depuis l'icône
  if (window.__dabaliInstall) return "prompt";                       // Chrome, Edge, Android
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return "ios";   // Safari iPhone : partage → écran d'accueil
  return "manual";
}

/**
 * Garder Dabali sur l'écran d'accueil (téléphone) ou comme appli du navigateur (ordinateur).
 * variant « card » : carte refermable sur l'accueil ; « row » : ligne permanente dans le profil / le menu.
 */
export function InstallApp({ variant = "card", dark = false }: { variant?: "card" | "row" | "compact"; dark?: boolean }) {
  const [mode, setMode] = useState<Mode>("hidden");
  const [dismissed, setDismissed] = useState(true);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const update = () => setMode(detect());
    update();
    try { setDismissed(variant === "card" && localStorage.getItem(DISMISS) === "1"); } catch { setDismissed(false); }
    window.addEventListener("dabali:installable", update);
    window.addEventListener("dabali:installed", update);
    return () => { window.removeEventListener("dabali:installable", update); window.removeEventListener("dabali:installed", update); };
  }, [variant]);

  if (mode === "hidden" || dismissed) return null;
  if (variant === "card" && mode === "manual") return null; // sur l'accueil : seulement quand le navigateur sait installer

  async function install() {
    const e = window.__dabaliInstall;
    if (mode === "prompt" && e) {
      await e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === "accepted") { window.__dabaliInstall = null; setMode("hidden"); }
      return;
    }
    setHelp((h) => !h);
  }

  if (variant === "compact") {
    if (mode === "manual") return null;
    return (
      <button onClick={install} className="flex h-9 w-full items-center gap-3 rounded-xl px-3 text-sm font-bold text-ink-2 hover:bg-canvas">
        <Download className="size-4" />Installer l&apos;appli
      </button>
    );
  }

  const steps = mode === "ios"
    ? <>Dans Safari, touchez <Share className="inline size-4" /> <b>Partager</b>, puis <SquarePlus className="inline size-4" /> <b>Sur l&apos;écran d&apos;accueil</b>.</>
    : <>Dans le menu du navigateur (⋮ ou ⋯), choisissez <b>Installer Dabali</b> ou <b>Ajouter à l&apos;écran d&apos;accueil</b>. Sur ordinateur : l&apos;icône <Download className="inline size-4" /> au bout de la barre d&apos;adresse.</>;

  return (
    <div className={clsx("rounded-[20px] p-3.5", dark ? "bg-white/10 text-white" : variant === "card" ? "bg-ink text-white" : "bg-card shadow-[var(--shadow-card)]")}>
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Installer l&apos;appli Dabali</p>
          <p className={clsx("text-xs", variant === "card" || dark ? "text-white/60" : "text-muted")}>Une icône sur l&apos;écran d&apos;accueil, plein écran, QR même hors ligne.</p>
        </div>
        <button onClick={install} className="shrink-0 rounded-full bg-lime px-3.5 py-2 text-xs font-extrabold text-ink">
          {mode === "prompt" ? "Installer" : "Comment ?"}
        </button>
        {variant === "card" && (
          <button aria-label="Masquer" onClick={() => { try { localStorage.setItem(DISMISS, "1"); } catch {} setDismissed(true); }} className="text-white/50"><X className="size-4" /></button>
        )}
      </div>
      {help && <p className={clsx("mt-2.5 text-[13px] leading-relaxed", variant === "card" || dark ? "text-white/80" : "text-ink-2")}>{steps}</p>}
    </div>
  );
}
