"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { myId, supabase } from "@/lib/supabase/client";
import { PROFILE_COLUMNS, type Profile } from "@/lib/types";
import { buzz, confetti } from "@/lib/confetti";
import { warmOffline, writeCache } from "@/lib/offline";
import { fetchMenu } from "@/lib/menu";
import { addDays, todayISO } from "@/lib/format";

type AppData = {
  profile: Profile | null;
  balance: number | null;
  unread: number;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AppData>({ profile: null, balance: null, unread: 0, refresh: async () => {} });

/** Profil + solde + notifications non lues, mis à jour en temps réel. */
export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    const sb = supabase();
    const uid = await myId();
    if (!uid || !navigator.onLine) return; // hors ligne : on garde les valeurs du cache
    const [p, w, n] = await Promise.all([
      sb.from("profiles").select(PROFILE_COLUMNS).eq("id", uid).single(),
      sb.from("wallets").select("balance").eq("user_id", uid).single(),
      sb.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", uid).is("read_at", null),
    ]);
    if (p.error && w.error) return;
    if (p.data) setProfile(p.data as Profile);
    if (w.data) setBalance(w.data.balance);
    setUnread(n.count ?? 0);
    try { localStorage.setItem("dabali:me", JSON.stringify({ profile: p.data, balance: w.data?.balance })); } catch {}
  }, []);

  useEffect(() => {
    // Affichage immédiat depuis le cache (utile hors ligne)
    try {
      const c = JSON.parse(localStorage.getItem("dabali:me") ?? "null");
      if (c?.profile) { setProfile(c.profile); setBalance(c.balance ?? null); }
    } catch {}
    refresh();

    const sb = supabase();
    let channel: ReturnType<typeof sb.channel> | undefined;
    myId().then((uid) => {
      if (!uid) return;
      const user = { id: uid };
      channel = sb
        .channel(`me-${user.id}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wallets", filter: `user_id=eq.${user.id}` },
          (pl) => setBalance((pl.new as { balance: number }).balance))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
          (pl) => setProfile((p) => (p ? { ...p, points: (pl.new as { points: number }).points ?? p.points } : p)))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
          () => setUnread((u) => u + 1))
        .subscribe();
    });
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("focus", onFocus); if (channel) sb.removeChannel(channel); };
  }, [refresh]);

  // Appli client ouverte en ligne : on garde toutes ses pages (et leurs fichiers) pour le mode avion
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const warm = () => {
      clearTimeout(id);
      id = setTimeout(async () => {
        warmOffline();
        // Données aussi : historique et menu de la semaine, même jamais ouverts
        const uid = await myId();
        if (!uid || !navigator.onLine) return;
        const { data } = await supabase().from("transactions").select("id, type, amount, balance_after, note, created_at, counterpart_name")
          .eq("user_id", uid).order("created_at", { ascending: false }).limit(150);
        if (data) writeCache("dabali:tx", data);
        fetchMenu(todayISO(), addDays(todayISO(), 7)).catch(() => {});
      }, 2500);
    };
    warm();
    window.addEventListener("online", warm);
    return () => { clearTimeout(id); window.removeEventListener("online", warm); };
  }, []);

  // 10 points atteints : confettis une fois par petit-déjeuner gagné (pas au premier affichage d'un appareil)
  useEffect(() => {
    if (!profile) return;
    const key = `dabali:rewards:${profile.id}`;
    const won = Math.floor(profile.points / 10);
    try {
      const seen = localStorage.getItem(key);
      if (seen !== null && won > Number(seen)) { confetti(); buzz([30, 50, 30, 50, 60]); }
      localStorage.setItem(key, String(won));
    } catch {}
  }, [profile]);

  return <Ctx.Provider value={{ profile, balance, unread, refresh }}>{children}</Ctx.Provider>;
}

export const useAppData = () => useContext(Ctx);
