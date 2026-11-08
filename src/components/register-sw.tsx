"use client";
import { useEffect } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
declare global { interface Window { __dabaliInstall?: InstallEvent | null } }

export function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    // Chrome / Edge / Android : l'invitation à installer arrive tôt ; on la garde pour le bouton « Installer »
    const onPrompt = (e: Event) => { e.preventDefault(); window.__dabaliInstall = e as InstallEvent; window.dispatchEvent(new Event("dabali:installable")); };
    const onInstalled = () => { window.__dabaliInstall = null; window.dispatchEvent(new Event("dabali:installed")); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  return null;
}
