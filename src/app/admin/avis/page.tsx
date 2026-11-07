"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { Star, TrendingDown, TrendingUp } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Card, PageTitle, Badge } from "@/components/admin/ui";
import { DishImage } from "@/components/app/dish-image";
import { dateTime } from "@/lib/format";

type R = {
  dishes: { id: string; name: string; photo_url: string | null; avg_stars: number | null; n: number; dist: Record<string, number>; last7: number | null }[];
  recent: { id: string; dish: string; stars: number; comment: string; author: string | null; created_at: string }[];
};

function Stars({ n, size = "size-3.5" }: { n: number; size?: string }) {
  return <span className="flex">{[1, 2, 3, 4, 5].map((k) => <Star key={k} className={clsx(size, k <= Math.round(n) ? "fill-warn text-warn" : "text-line")} />)}</span>;
}

export default function RatingsPage() {
  const [r, setR] = useState<R | null>(null);
  useEffect(() => { supabase().rpc("admin_ratings").then(({ data }) => setR(data as R)); }, []);
  const rated = r?.dishes.filter((d) => d.n > 0) ?? [];
  const total = rated.reduce((s, d) => s + d.n, 0);
  const avg = total ? rated.reduce((s, d) => s + (d.avg_stars ?? 0) * d.n, 0) / total : 0;

  return (
    <>
      <PageTitle title="Avis clients" subtitle="Notés après chaque repas servi" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Notes par plat" subtitle="Du moins bien noté au mieux noté"
          action={<div className="text-right"><p className="text-2xl font-extrabold">{avg.toFixed(2)}</p><p className="text-xs text-muted">{total} avis</p></div>}>
          <div className="space-y-3">
            {rated.map((d, i) => {
              const trend = d.last7 != null && d.avg_stars != null ? d.last7 - d.avg_stars : 0;
              return (
                <div key={d.id} className={clsx("flex items-center gap-3 rounded-2xl p-2.5", i < 2 && (d.avg_stars ?? 5) < 4.1 ? "bg-err-soft/60" : "")}>
                  <DishImage name={d.name} src={d.photo_url} className="size-12" rounded="rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{d.name}</p>
                    <div className="mt-1 flex items-center gap-2"><Stars n={d.avg_stars ?? 0} /><span className="text-xs text-muted">{d.n} avis</span></div>
                  </div>
                  <div className="hidden w-32 sm:block">
                    {[5, 4, 3, 2, 1].map((k) => (
                      <div key={k} className="flex items-center gap-1 text-[10px] text-muted">
                        <span className="w-2">{k}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-ink-2" style={{ width: `${(d.dist[k] / Math.max(d.n, 1)) * 100}%` }} /></div>
                      </div>
                    ))}
                  </div>
                  <div className="w-16 text-right">
                    <p className="text-lg font-extrabold">{d.avg_stars?.toFixed(1)}</p>
                    {Math.abs(trend) >= 0.1 && (
                      <span className={clsx("flex items-center justify-end gap-0.5 text-[11px] font-bold", trend > 0 ? "text-[#15803d]" : "text-err")}>
                        {trend > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}{trend > 0 ? "+" : ""}{trend.toFixed(1)} /7j
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Derniers commentaires">
          <div className="space-y-3">
            {r?.recent.map((c) => (
              <div key={c.id} className="rounded-2xl bg-canvas p-3.5">
                <div className="flex items-center justify-between gap-2"><Badge>{c.dish}</Badge><Stars n={c.stars} /></div>
                <p className="mt-2 text-sm font-medium">« {c.comment} »</p>
                <p className="mt-1 text-xs text-muted">{c.author ?? "Client"} · {dateTime(c.created_at)}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
