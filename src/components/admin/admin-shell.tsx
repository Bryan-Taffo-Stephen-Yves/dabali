"use client";
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import {
  LayoutDashboard, Wallet, CalendarDays, UtensilsCrossed, TrendingUp, Boxes, BarChart3, Trash2, Star,
  ChefHat, Users, Settings, LogOut, ScanLine, Smartphone, UserCog, ShoppingCart, ShieldCheck, MoreHorizontal,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import { PushToggle } from "@/components/push-toggle";
import { InstallApp } from "@/components/install-app";
import { PROFILE_COLUMNS, type Profile } from "@/lib/types";
import type { Role } from "@/lib/roles";

const NAV: { href: string; label: string; icon: typeof Wallet; roles: Role[] }[] = [
  { href: "/admin", label: "Vue d'ensemble", icon: LayoutDashboard, roles: ["caissier", "chef", "admin"] },
  { href: "/admin/caisse", label: "Caisse", icon: Wallet, roles: ["caissier", "admin"] },
  { href: "/admin/commandes", label: "Commandes", icon: ChefHat, roles: ["chef", "admin"] },
  { href: "/admin/menu", label: "Menu hebdo", icon: CalendarDays, roles: ["chef", "admin"] },
  { href: "/admin/plats", label: "Plats", icon: UtensilsCrossed, roles: ["chef", "admin"] },
  { href: "/admin/previsions", label: "Prévisions", icon: TrendingUp, roles: ["chef", "admin"] },
  { href: "/admin/stock", label: "Stock", icon: Boxes, roles: ["chef", "admin"] },
  { href: "/admin/courses", label: "Courses", icon: ShoppingCart, roles: ["chef", "admin"] },
  { href: "/admin/ventes", label: "Ventes", icon: BarChart3, roles: ["caissier", "chef", "admin"] },
  { href: "/admin/scans", label: "Scans", icon: ScanLine, roles: ["caissier", "chef", "admin"] },
  { href: "/admin/gaspillage", label: "Gaspillage", icon: Trash2, roles: ["chef", "admin"] },
  { href: "/admin/avis", label: "Avis", icon: Star, roles: ["chef", "admin"] },
  { href: "/admin/affluence", label: "Affluence", icon: Users, roles: ["caissier", "chef", "admin"] },
  { href: "/admin/equipe", label: "Équipe", icon: UserCog, roles: ["admin"] },
  { href: "/admin/parametres", label: "Paramètres", icon: Settings, roles: ["admin"] },
];

const ROLE_LABEL: Record<string, string> = { admin: "Administrateur", chef: "Chef", caissier: "Caisse", agent: "Agent", client: "Client" };

const Ctx = createContext<Profile | null>(null);
export const useStaff = () => useContext(Ctx);

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [path]);

  useEffect(() => {
    supabase().auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase().from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).single();
      setMe(data as Profile);
    });
  }, []);

  const items = NAV.filter((n) => me && n.roles.includes(me.role));
  // Page ouverte par son adresse alors qu'elle n'est pas prévue pour ce rôle : message clair au lieu d'une page vide
  const page = [...NAV].sort((a, b) => b.href.length - a.href.length).find((n) => path === n.href || path.startsWith(n.href + "/"));
  const forbidden = !!(me && page && !page.roles.includes(me.role));
  const logout = async () => { await supabase().auth.signOut(); router.replace("/connexion"); };

  return (
    <Ctx.Provider value={me}>
      <div className="min-h-dvh lg:flex">
        {/* Barre latérale (bureau) */}
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-card px-4 py-5 lg:flex">
          <Logo className="px-2" />
          <nav className="mt-7 flex-1 space-y-0.5 overflow-y-auto">
            {items.map((n) => {
              const active = n.href === "/admin" ? path === "/admin" : path.startsWith(n.href);
              const I = n.icon;
              return (
                <Link key={n.href} href={n.href}
                  className={clsx("flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-bold transition",
                    active ? "bg-ink text-white" : "text-ink-2 hover:bg-canvas")}>
                  <I className={clsx("size-[18px]", active && "text-lime")} />{n.label}
                </Link>
              );
            })}
          </nav>
          {/* Bas de la barre : un seul bloc profil, le reste dans un menu « ⋯ » (la navigation garde toute la hauteur) */}
          <div className="relative border-t border-line pt-3">
            {more && (
              <>
                <button aria-label="Fermer le menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setMore(false)} />
                <div className="animate-rise absolute inset-x-0 bottom-[calc(100%+0.5rem)] z-20 space-y-0.5 rounded-2xl border border-line bg-card p-2 shadow-[var(--shadow-float)]">
                  {me && ["agent", "admin"].includes(me.role) && (
                    <Link href="/scan" className="flex h-9 items-center gap-3 rounded-xl px-3 text-sm font-bold text-ink-2 hover:bg-canvas"><ScanLine className="size-4" />Scanner</Link>
                  )}
                  <Link href="/app" className="flex h-9 items-center gap-3 rounded-xl px-3 text-sm font-bold text-ink-2 hover:bg-canvas"><Smartphone className="size-4" />Appli client</Link>
                  <InstallApp variant="compact" />
                  <PushToggle compact />
                  <Link href="/double-authentification?next=/admin" className="flex h-9 items-center gap-3 rounded-xl px-3 text-sm font-bold text-ink-2 hover:bg-canvas"><ShieldCheck className="size-4" />Double authentification</Link>
                  <button onClick={logout} className="flex h-9 w-full items-center gap-3 rounded-xl px-3 text-sm font-bold text-err hover:bg-err-soft"><LogOut className="size-4" />Déconnexion</button>
                </div>
              </>
            )}
            <button onClick={() => setMore((v) => !v)} aria-expanded={more} aria-label="Menu du compte"
              className="flex w-full items-center gap-3 rounded-xl bg-canvas p-3 text-left transition hover:bg-line/60">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lime text-sm font-extrabold">{me?.full_name?.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{me?.full_name}</span>
                <span className="block text-xs text-muted">{me ? ROLE_LABEL[me.role] : ""}</span>
              </span>
              <MoreHorizontal className="size-5 text-muted" />
            </button>
          </div>
        </aside>

        {/* En-tête (mobile / tablette) */}
        <div className="sticky top-0 z-30 border-b border-line bg-card/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <Logo />
            <button onClick={logout} className="text-sm font-bold text-muted">Déconnexion</button>
          </div>
          <nav className="flex gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
            {items.map((n) => {
              const active = n.href === "/admin" ? path === "/admin" : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href}
                  className={clsx("h-8 shrink-0 rounded-full px-3 text-[13px] font-bold leading-8", active ? "bg-ink text-white" : "bg-canvas text-ink-2")}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-[1200px]">
            {!me ? (
              // Profil pas encore chargé : on attend avant de monter la page (évite des appels refusés pour ce rôle)
              <div className="space-y-4"><div className="h-8 w-56 animate-pulse rounded-xl bg-card" /><div className="h-64 animate-pulse rounded-[22px] bg-card" /></div>
            ) : forbidden ? (
              <div className="mx-auto mt-16 max-w-md rounded-[22px] border border-line bg-card p-8 text-center">
                <ShieldCheck className="mx-auto size-10 text-muted" />
                <h1 className="mt-3 text-xl font-extrabold">Page réservée</h1>
                <p className="mt-1 text-sm text-muted">« {page?.label} » n&apos;est pas accessible avec votre rôle. Demandez à l&apos;administrateur si vous en avez besoin.</p>
                <Link href="/admin" className="mt-5 inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-bold text-white">Retour à la vue d&apos;ensemble</Link>
              </div>
            ) : children}
          </div>
        </main>
      </div>
    </Ctx.Provider>
  );
}
