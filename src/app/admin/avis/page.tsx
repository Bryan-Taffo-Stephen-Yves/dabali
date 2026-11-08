"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { MessageCircleReply, Star, TrendingDown, TrendingUp } from "lucide-react";
import { rpc, supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { reviewPhotoUrl } from "@/lib/reviews";
import { Card, PageTitle, Badge } from "@/components/admin/ui";
import { DishImage } from "@/components/app/dish-image";
import { dateTime } from "@/lib/format";

type R = {
  dishes: { id: string; name: string; photo_url: string | null; avg_stars: number | null; n: number; dist: Record<string, number>; last7: number | null }[];
  recent: { id: string; dish: string; stars: number; comment: string | null; author: string | null; created_at: string;
            complaints: string[]; complaint_labels: string[] | null; photo_path: string | null; reply: string | null; replied_at: string | null }[];
  complaints: { code: string; label: string; n: number }[];
};

function Stars({ n, size = "size-3.5" }: { n: number; size?: string }) {
  return <span className="flex">{[1, 2, 3, 4, 5].map((k) => <Star key={k} className={clsx(size, k <= Math.round(n) ? "fill-warn text-warn" : "text-line")} />)}</span>;
}

export default function RatingsPage() {
  const toast = useToast();
  const [r, setR] = useState<R | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const load = useCallback(() => { supabase().rpc("admin_ratings").then(({ data }) => setR(data as R)); }, []);
  useEffect(() => { load(); }, [load]);
  async function reply(id: string) {
    const res = await rpc("reply_review", { p_rating_id: id, p_reply: drafts[id] ?? "" });
    if (!res.ok) return toast("err", res.message);
    toast("ok", "Réponse envoyée au client.");
    setDrafts((d) => ({ ...d, [id]: "" }));
    load();
  }
  const rated = r?.dishes.filter((d) => d.n > 0) ?? [];
  const total = rated.reduce((s, d) => s + d.n, 0);
  const avg = total ? rated.reduce((s, d) => s + (d.avg_stars ?? 0) * d.n, 0) / total : 0;

  return (
    <>
      <PageTitle title="Avis clients" subtitle="Demandés 30 min après chaque repas · photos et plaintes" />
      {r && r.complaints.length > 0 && (
        <Card className="mb-4" title="Plaintes des 30 derniers jours" subtitle="Ce qui revient le plus souvent">
          <div className="flex flex-wrap gap-2">
            {r.complaints.map((c) => (
              <span key={c.code} className={clsx("rounded-full px-3 py-1.5 text-sm font-bold", c.code === "corps_etranger" ? "bg-err text-white" : "bg-err-soft text-err")}>
                {c.label} · {c.n}
              </span>
            ))}
          </div>
        </Card>
      )}
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
        <Card title="Derniers avis" subtitle="Commentaires, photos et plaintes · répondez au client">
          <div className="space-y-3">
            {r?.recent.map((c) => (
              <div key={c.id} className={clsx("rounded-2xl p-3.5", c.complaints?.includes("corps_etranger") ? "bg-err-soft ring-2 ring-err/40" : "bg-canvas")}>
                <div className="flex items-center justify-between gap-2"><Badge>{c.dish}</Badge><Stars n={c.stars} /></div>
                {c.complaint_labels && c.complaint_labels.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">{c.complaint_labels.map((l) => <span key={l} className="rounded-full bg-err px-2 py-0.5 text-[11px] font-bold text-white">{l}</span>)}</div>
                )}
                {c.comment && <p className="mt-2 text-sm font-medium">« {c.comment} »</p>}
                {c.photo_path && (
                  <a href={reviewPhotoUrl(c.photo_path)!} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={reviewPhotoUrl(c.photo_path)!} alt={`Photo du client · ${c.dish}`} loading="lazy" className="mt-2 h-36 w-full rounded-xl object-cover" />
                  </a>
                )}
                <p className="mt-1 text-xs text-muted">{c.author ?? "Client"} · {dateTime(c.created_at)}</p>
                {c.reply ? (
                  <p className="mt-2 flex gap-1.5 rounded-xl bg-card p-2.5 text-xs"><MessageCircleReply className="size-4 shrink-0 text-lime-deep" /><span><b>Votre réponse :</b> {c.reply}</span></p>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <input value={drafts[c.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                      placeholder="Répondre au client…" className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 text-sm" />
                    <button onClick={() => reply(c.id)} disabled={!drafts[c.id]?.trim()} className="rounded-xl bg-ink px-3 text-xs font-bold text-white disabled:opacity-40">Envoyer</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
