"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import { Bell } from "lucide-react";
import { supabase, myId } from "@/lib/supabase/client";
import { readCache, writeCache } from "@/lib/offline";
import { PageHeader } from "@/components/app/page-header";
import { useAppData } from "@/components/app/app-data";
import { dateTime } from "@/lib/format";

type N = { id: string; type: string; title: string; body: string | null; read_at: string | null; created_at: string; data: { href?: string } | null };

export default function NotificationsPage() {
  const { refresh } = useAppData();
  const [list, setList] = useState<N[] | null>(null);

  useEffect(() => {
    (async () => {
      const sb = supabase();
      const cached = readCache<N[]>("dabali:notifs");
      if (cached) setList(cached);
      const uid = await myId();
      if (!uid || !navigator.onLine) { setList((l) => l ?? []); return; }
      const { data, error } = await sb.from("notifications").select("id, type, title, body, read_at, created_at, data")
        .eq("user_id", uid).order("created_at", { ascending: false }).limit(50);
      if (error || !data) { setList((l) => l ?? []); return; }
      setList(data);
      writeCache("dabali:notifs", data);
      await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", uid).is("read_at", null);
      refresh();
    })();
  }, [refresh]);

  return (
    <main>
      <PageHeader title="Notifications" />
      <div className="space-y-2.5 px-4">
        {list === null && <div className="h-40 animate-pulse rounded-[22px] bg-card" />}
        {list?.length === 0 && (
          <div className="flex flex-col items-center rounded-[24px] border-2 border-dashed border-line p-10 text-center">
            <Bell className="size-8 text-off" /><p className="mt-2 font-bold">Rien de neuf</p>
          </div>
        )}
        {list?.map((n) => {
          const href = n.data?.href?.startsWith("/app/") ? n.data.href : null;
          const card = (
          <div className={clsx("rounded-[20px] bg-card p-4 shadow-[var(--shadow-card)]", !n.read_at && "ring-2 ring-lime")}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-bold">{n.title}</p>
              {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-lime-deep" />}
            </div>
            {n.body && <p className="mt-1 text-sm text-ink-2">{n.body}</p>}
            <p className="mt-1.5 flex items-center justify-between text-[11px] font-semibold text-off">{dateTime(n.created_at)}
              {href && <span className="flex items-center gap-0.5 text-xs font-bold text-ink">Ouvrir<ChevronRight className="size-3.5" /></span>}</p>
          </div>
          );
          return href ? <Link key={n.id} href={href} className="block">{card}</Link> : <div key={n.id}>{card}</div>;
        })}
      </div>
    </main>
  );
}
