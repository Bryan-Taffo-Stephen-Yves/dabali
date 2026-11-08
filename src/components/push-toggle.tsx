"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { Bell, BellOff, Share } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";

/** Activer / couper les notifications push sur ce téléphone (même appli fermée). */
export function PushToggle({ dark = false }: { dark?: boolean }) {
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

  if (st === null || st === "unsupported") return null;
  const box = clsx("flex w-full items-center gap-3 rounded-[20px] p-3.5 text-left", dark ? "bg-white/10 text-white" : "bg-card shadow-[var(--shadow-card)]");
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
