"use client";
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Camera, MessageCircleReply, Star, X } from "lucide-react";
import { rpc, supabase, myId } from "@/lib/supabase/client";
import { PageHeader } from "@/components/app/page-header";
import { DishImage } from "@/components/app/dish-image";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { COMPLAINTS, complaintLabel, compressPhoto, reviewPhotoUrl } from "@/lib/reviews";
import { dateTime, SERVICE_LABEL } from "@/lib/format";
import type { ServiceKind } from "@/lib/types";

type T = { id: string; service: ServiceKind; used_at: string | null; status: string; dish: { name: string; photo_url: string | null } | null };
type Review = { id: string; stars: number; comment: string | null; complaints: string[]; photo_path: string | null; reply: string | null; replied_at: string | null; created_at: string };

const HINT = ["", "Pas bon du tout", "Bof", "Correct", "Bon", "Excellent !"];

/** Avis sur un repas : note, plainte en un clic, commentaire, photo facultative. */
export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [t, setT] = useState<T | null | undefined>(undefined);
  const [review, setReview] = useState<Review | null | undefined>(undefined);
  const [stars, setStars] = useState(0);
  const [complaints, setComplaints] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = Number(new URLSearchParams(window.location.search).get("stars"));
    if (q >= 1 && q <= 5) setStars(q);
    const sb = supabase();
    sb.from("tickets").select("id, service, used_at, status, dish:dishes(name, photo_url)").eq("id", id).maybeSingle()
      .then(({ data }) => setT(data as unknown as T | null));
    sb.rpc("my_review", { p_ticket_id: id }).then(({ data }) => setReview((data as Review | null) ?? null));
  }, [id]);

  function toggle(c: string) { setComplaints((l) => (l.includes(c) ? l.filter((x) => x !== c) : [...l, c])); }

  async function pick(f: File | undefined) {
    if (!f) return;
    try {
      const b = await compressPhoto(f);
      setPhoto(b);
      setPreview(URL.createObjectURL(b));
    } catch { toast("err", "Photo illisible."); }
  }

  async function send() {
    if (!stars) return toast("err", "Choisis une note.");
    setBusy(true);
    let path: string | null = null;
    if (photo) {
      const sb = supabase();
      path = `${await myId()}/${id}-${Date.now()}.jpg`;
      const { error } = await sb.storage.from("reviews").upload(path, photo, { contentType: "image/jpeg", upsert: false });
      if (error) { setBusy(false); return toast("err", "Envoi de la photo impossible."); }
    }
    const r = await rpc<{ alert: boolean }>("rate_ticket", { p_ticket_id: id, p_stars: stars, p_comment: comment || null, p_complaints: complaints, p_photo_path: path });
    setBusy(false);
    if (!r.ok) return toast("err", r.message);
    toast("ok", r.alert ? "Merci. La cuisine est prévenue tout de suite." : "Merci pour ton avis !");
    navigator.vibrate?.(60);
    router.replace("/app/tickets");
  }

  async function skip() {
    await rpc("dismiss_review", { p_ticket_id: id });
    router.replace("/app");
  }

  if (t === undefined || review === undefined) return <main><PageHeader title="Ton avis" /><div className="mx-4 h-80 animate-pulse rounded-[24px] bg-card" /></main>;
  if (!t || !t.dish) return <main><PageHeader title="Ton avis" /><p className="px-6 py-16 text-center text-sm text-muted">Ce repas ne peut pas être noté.</p></main>;

  return (
    <main className="pb-6">
      <PageHeader title="Ton avis" />
      <div className="px-4">
        <div className="overflow-hidden rounded-[24px] bg-card shadow-[var(--shadow-card)]">
          <DishImage name={t.dish.name} src={t.dish.photo_url} rounded="rounded-none" className="h-40 w-full" />
          <div className="p-4">
            <p className="text-xl font-extrabold">{t.dish.name}</p>
            <p className="text-sm text-muted">{SERVICE_LABEL[t.service]}{t.used_at ? ` · servi le ${dateTime(t.used_at)}` : ""}</p>
          </div>
        </div>

        {review ? (
          // Avis déjà donné : récapitulatif + réponse de la cuisine
          <div className="mt-4 space-y-3">
            <div className="rounded-[22px] bg-card p-4 shadow-[var(--shadow-card)]">
              <div className="flex">{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={clsx("size-6", n <= review.stars ? "fill-warn text-warn" : "text-line")} />)}</div>
              {review.complaints.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">{review.complaints.map((c) => <span key={c} className="rounded-full bg-err-soft px-2.5 py-1 text-xs font-bold text-err">{complaintLabel(c)}</span>)}</div>
              )}
              {review.comment && <p className="mt-2 text-sm">« {review.comment} »</p>}
              {review.photo_path && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={reviewPhotoUrl(review.photo_path)!} alt="Ta photo" loading="lazy" className="mt-3 max-h-64 w-full rounded-2xl object-cover" />
              )}
              <p className="mt-2 text-xs text-muted">Envoyé le {dateTime(review.created_at)}</p>
            </div>
            {review.reply ? (
              <div className="rounded-[22px] bg-ink p-4 text-white">
                <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-lime"><MessageCircleReply className="size-4" />Réponse de la cuisine</p>
                <p className="mt-2 text-sm">{review.reply}</p>
                {review.replied_at && <p className="mt-1.5 text-xs text-white/50">{dateTime(review.replied_at)}</p>}
              </div>
            ) : (
              <p className="px-1 text-sm text-muted">La cuisine lit tous les avis. Tu seras prévenu(e) si elle te répond.</p>
            )}
          </div>
        ) : (
          <>
            <div className="mt-4 rounded-[22px] bg-card p-5 text-center shadow-[var(--shadow-card)]">
              <p className="font-bold">Comment c&apos;était ?</p>
              <div className="mt-3 flex justify-center gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => setStars(n)} aria-label={`${n} étoile${n > 1 ? "s" : ""}`} className="p-1 transition active:scale-90">
                    <Star className={clsx("size-10 transition", n <= stars ? "fill-warn text-warn" : "text-line")} />
                  </button>
                ))}
              </div>
              <p className="mt-1 h-5 text-sm font-semibold text-muted">{HINT[stars]}</p>
            </div>

            <div className="mt-3 rounded-[22px] bg-card p-4 shadow-[var(--shadow-card)]">
              <p className="font-bold">Un souci ? <span className="text-sm font-semibold text-muted">facultatif</span></p>
              <div className="mt-3 flex flex-wrap gap-2">
                {COMPLAINTS.map((c) => (
                  <button key={c.code} onClick={() => toggle(c.code)}
                    className={clsx("rounded-full border px-3 py-1.5 text-sm font-semibold transition",
                      complaints.includes(c.code) ? (c.code === "corps_etranger" ? "border-err bg-err text-white" : "border-ink bg-ink text-white") : "border-line bg-canvas")}>
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
              <textarea value={comment} onChange={(e) => setComment(e.target.value.slice(0, 500))} rows={3}
                placeholder="Un mot pour la cuisine (facultatif)"
                className="mt-3 w-full rounded-2xl border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-ink" />

              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
              {preview ? (
                <div className="relative mt-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt="Aperçu" className="max-h-56 w-full rounded-2xl object-cover" />
                  <button onClick={() => { setPhoto(null); setPreview(null); }} aria-label="Retirer la photo"
                    className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-ink/70 text-white"><X className="size-4" /></button>
                </div>
              ) : (
                <button onClick={() => fileRef.current?.click()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line py-3 text-sm font-bold text-ink-2">
                  <Camera className="size-5" />Ajouter une photo
                </button>
              )}
            </div>

            <Button block size="lg" variant="dark" className="mt-4" loading={busy} disabled={!stars} onClick={send}>Envoyer mon avis</Button>
            <button onClick={skip} className="mt-3 w-full text-center text-sm font-bold text-muted">Ne pas noter ce repas</button>
          </>
        )}
      </div>
    </main>
  );
}
