"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, UtensilsCrossed, QrCode, ReceiptText, UserRound } from "lucide-react";
import clsx from "clsx";

const TABS = [
  { href: "/app", label: "Accueil", icon: Home, exact: true },
  { href: "/app/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/app/tickets", label: "Mon QR", icon: QrCode, center: true },
  { href: "/app/historique", label: "Historique", icon: ReceiptText },
  { href: "/app/profil", label: "Profil", icon: UserRound },
];

export function BottomNav() {
  const path = usePathname();
  // Écrans avec leur propre bouton d'action en bas : pas de barre d'onglets
  if (/^\/app\/(menu\/.+|recharger|transferer|acheter)/.test(path)) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))]">
      <div className="flex items-end justify-between rounded-[26px] border border-line bg-card/95 px-2 pb-2 pt-1.5 shadow-[var(--shadow-float)] backdrop-blur">
        {TABS.map((t) => {
          const active = t.exact ? path === t.href : path.startsWith(t.href);
          const Icon = t.icon;
          if (t.center) {
            return (
              <Link key={t.href} href={t.href} aria-label={t.label}
                className="-mt-7 flex flex-1 flex-col items-center gap-1">
                <span className={clsx(
                  "grid size-[60px] place-items-center rounded-[22px] ring-[5px] ring-canvas transition active:scale-95",
                  active ? "bg-ink text-lime" : "bg-lime text-ink shadow-[0_6px_18px_rgb(143_181_21/0.45)]",
                )}>
                  <Icon key={String(active)} className={clsx("size-7", active && "animate-nav")} strokeWidth={2.2} />
                </span>
                <span className={clsx("text-[11px] font-bold", active ? "text-ink" : "text-muted")}>{t.label}</span>
              </Link>
            );
          }
          return (
            <Link key={t.href} href={t.href} className="flex min-h-12 flex-1 flex-col items-center justify-end gap-1 pt-1.5">
              <Icon key={String(active)} className={clsx("size-[22px] transition", active ? "animate-nav text-ink" : "text-off")} strokeWidth={active ? 2.4 : 2} />
              <span className={clsx("text-[11px] font-bold", active ? "text-ink" : "text-muted")}>{t.label}</span>
              <span className={clsx("h-1 w-1 rounded-full", active ? "bg-lime-deep" : "bg-transparent")} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
