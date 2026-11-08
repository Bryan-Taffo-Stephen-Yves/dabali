"use client";
import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/** Bandeau discret quand le téléphone n'a plus de réseau */
export function OfflineBanner() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const f = () => setOff(!navigator.onLine);
    f();
    window.addEventListener("online", f); window.addEventListener("offline", f);
    return () => { window.removeEventListener("online", f); window.removeEventListener("offline", f); };
  }, []);
  if (!off) return null;
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-ink px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-xs font-bold text-white" role="status">
      <WifiOff className="size-4 text-lime" />Hors ligne · vos QR marchent, achats et transferts au retour du réseau
    </div>
  );
}
