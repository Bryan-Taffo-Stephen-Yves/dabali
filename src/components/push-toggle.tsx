"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { Bell, BellOff, Share } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";

/** Activer / couper les notifications push sur ce téléphone (même appli fermée). */
export function PushToggle({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  const toast = useToast();
  const [st, setSt] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushState().then(setSt); }, []);

  async function toggle() {
    setBusy(true);
    try {
      const next = st === "on" ? await disablePush() : await enablePush();
      setSt(next);
      if (next === "on") toast("ok", "Notifications activées sur ce téléphone.");
      if (next === "denied") toast("err", "Notifications bloquées : autorisez-les dans les réglages du navigateur.");
    } catch { toast("err", "Activation impossible pour le moment."); }
    setBusy(false);
  }

  const box = clsx("flex w-full items-center gap-3 rounded-[20px] p-3.5 text-left", dark ? "bg-white/10 text-white" : "bg-card shadow-[var(--shadow-card)]");
  // Version compacte (barre latérale de l'admin) : une ligne, sans description
  if (compact) {
    if (st === null || st === "unsupported" || st === "ios-install") return null;
    return (
      <button onClick={toggle} disabled={busy || st === "denied"} title={st === "denied" ? "Bloquées dans les réglages du navigateur" : undefined}
        className="flex h-9 w-full items-center gap-3 rounded-xl px-3 text-sm font-bold text-ink-2 hover:bg-canvas disabled:opacity-60">
        {st === "on" ? <Bell className="size-4 text-lime-deep" /> : <BellOff className="size-4" />}
        <span className="flex-1 text-left">Notifications</span>
        <span className={clsx("relative h-5 w-9 rounded-full transition", st === "on" ? "bg-ok" : "bg-line")}>
          <span className={clsx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", st === "on" ? "left-[18px]" : "left-0.5")} />
        </span>
      </button>
    );
  }
  if (st === null) return <div className={clsx(box, "h-[68px] animate-pulse")} />;
  if (st === "unsupported") {
    // Toujours visible, avec la raison : sinon l'utilisateur ne sait pas que la fonction existe
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const v = navigator.userAgent.match(/OS (\d+)_(\d+)/);
    return (
      <div className={box}>
        <BellOff className="size-5 shrink-0 opacity-60" />
        <p className="text-sm">
          <b>Notifications indisponibles sur cet appareil.</b>{" "}
          {ios
            ? <>Il faut iOS 16.4 ou plus récent{v ? <> (vous avez iOS {v[1]}.{v[2]})</> : null} : Réglages → Général → Mise à jour logicielle, puis rouvrez Dabali depuis l&apos;icône.</>
            : <>Utilisez Chrome, Edge, Firefox ou Safari récent.</>}
        </p>
      </div>
    );
  }
  if (st === "ios-install") return (
    <div className={box}>
      <Share className="size-5 shrink-0" />
      <p className="text-sm"><b>iPhone :</b> pour recevoir les notifications, touchez Partager puis « Sur l&apos;écran d&apos;accueil », et ouvrez Dabali depuis l&apos;icône.</p>
    </div>
  );
  return (
    <button onClick={toggle} disabled={busy || st === "denied"} className={box}>
      {st === "on" ? <Bell className="size-5 shrink-0 text-lime-deep" /> : <BellOff className="size-5 shrink-0" />}
      <span className="flex-1">
        <span className="block text-sm font-bold">Notifications sur ce téléphone</span>
        <span className={clsx("block text-xs", dark ? "text-white/60" : "text-muted")}>
          {st === "on" ? "Activées, même appli fermée" : st === "denied" ? "Bloquées dans les réglages du navigateur" : "Avis, tickets offerts, courses, alertes…"}
        </span>
      </span>
      <span className={clsx("relative h-6 w-11 rounded-full transition", st === "on" ? "bg-ok" : dark ? "bg-white/20" : "bg-line")}>
        <span className={clsx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", st === "on" ? "left-[22px]" : "left-0.5")} />
      </span>
    </button>
  );
}
