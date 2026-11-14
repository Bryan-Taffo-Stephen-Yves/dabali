"use client";
import { useCallback, useEffect, useState } from "react";
import { MessageCircle, ChevronRight, Copy } from "lucide-react";
import { myId, rpc, supabase } from "@/lib/supabase/client";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** Profil : lier son WhatsApp à Jean, l'assistant de la cantine (code à 6 chiffres à lui envoyer). */
export function WhatsAppLink({ autoOpen = false }: { autoOpen?: boolean }) {
  const toast = useToast();
  const [linked, setLinked] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<{ code: string; jean: string | null; until: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const uid = await myId();
    if (!uid) return;
    const { data } = await supabase().from("whatsapp_links").select("phone").eq("user_id", uid).maybeSingle();
    setLinked(data?.phone ?? null);
  }, []);
  useEffect(() => { load(); }, [load]);

  const start = useCallback(async () => {
    setOpen(true); setBusy(true);
    const r = await rpc<{ code: string; jean_phone: string | null; expires_at: string }>("whatsapp_link_start");
    setBusy(false);
    if (!r.ok) { toast("err", r.message); setOpen(false); return; }
    setCode({ code: r.code, jean: r.jean_phone, until: r.expires_at });
  }, [toast]);
  useEffect(() => { if (autoOpen && linked === null) start(); }, [autoOpen, linked, start]);

  // Liaison faite depuis WhatsApp : on rafraîchit pendant que la feuille est ouverte
  useEffect(() => {
    if (!open || linked) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [open, linked, load]);
  useEffect(() => { if (open && linked) { toast("ok", "WhatsApp lié : Jean te reconnaît maintenant."); setOpen(false); } }, [open, linked, toast]);

  async function unlink() {
    if (!confirm("Délier WhatsApp ? Jean ne te reconnaîtra plus sur ce numéro.")) return;
    const r = await rpc("whatsapp_unlink");
    if (!r.ok) return toast("err", r.message);
    toast("ok", "WhatsApp délié."); load();
  }

  const wa = code?.jean ? `https://wa.me/${code.jean.replace(/\D/g, "")}?text=${code.code}` : null;
  return (
    <>
      <button onClick={linked ? unlink : start} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <span className="grid size-10 place-items-center rounded-xl bg-[#25D366]/15"><MessageCircle className="size-5 text-[#128C7E]" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold">{linked ? "WhatsApp lié à Jean" : "Lier mon WhatsApp"}</span>
          <span className="block text-[13px] text-muted">{linked === undefined ? "…" : linked ? `${linked} · toucher pour délier` : "Commande et suis tes repas avec Jean, l'assistant de la cantine"}</span>
        </span>
        <ChevronRight className="size-5 text-off" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Lier mon WhatsApp">
        <p className="-mt-2 text-sm text-muted">Envoie ce code à Jean sur WhatsApp, depuis TON numéro. Il est valable 10 minutes.</p>
        <div className="my-5 text-center">
          {busy || !code ? <div className="mx-auto h-16 w-56 animate-pulse rounded-2xl bg-canvas" />
            : <p className="font-mono text-5xl font-extrabold tracking-[0.2em]">{code.code.slice(0, 3)} {code.code.slice(3)}</p>}
        </div>
        {wa ? (
          <a href={wa} target="_blank" rel="noopener" className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#25D366] text-base font-extrabold text-white">
            <MessageCircle className="size-5" />Envoyer à Jean sur WhatsApp
          </a>
        ) : (
          <p className="rounded-xl bg-warn-soft px-3 py-2 text-center text-sm font-bold">Le numéro de Jean n&apos;est pas encore configuré.</p>
        )}
        {code && (
          <Button variant="ghost" block className="mt-2" onClick={() => { navigator.clipboard?.writeText(code.code); toast("ok", "Code copié"); }}>
            <Copy className="size-4" />Copier le code
          </Button>
        )}
        <p className="mt-3 text-center text-xs text-muted">Jean ne te demandera jamais ton code PIN. Tes commandes se confirment toujours dans l&apos;appli.</p>
      </Sheet>
    </>
  );
}
