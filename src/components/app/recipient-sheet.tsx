"use client";
import { useEffect, useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import { rpc } from "@/lib/supabase/client";
import { Sheet } from "@/components/ui/sheet";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export type Recipient = { id: string; full_name: string; short_code?: string };

/** Recherche d'un destinataire : téléphone, identifiant court ou scan de son QR de profil (§4.7) */
export function RecipientSheet({ open, onClose, onPick, title }: {
  open: boolean; onClose: () => void; onPick: (u: Recipient) => void; title: string;
}) {
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);

  async function lookup(value: string) {
    setBusy(true); setErr(null);
    const r = await rpc<Recipient>("lookup_recipient", { p_query: value });
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    onPick({ id: r.id, full_name: r.full_name, short_code: r.short_code });
    setQ(""); setScan(false);
  }

  return (
    <Sheet open={open} onClose={() => { setScan(false); onClose(); }} title={title}>
      {scan ? (
        <ProfileScanner onResult={(v) => lookup(v)} onCancel={() => setScan(false)} />
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); lookup(q); }} className="space-y-4">
          <Field label="Téléphone ou identifiant" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="07 07 07 07 07 ou DB-2026" error={err} autoFocus inputMode="text" />
          <Button type="submit" block size="lg" loading={busy} disabled={q.trim().length < 4}>Rechercher</Button>
          <Button type="button" block variant="outline" onClick={() => setScan(true)}>
            <ScanLine className="size-5" /> Scanner son QR de profil
          </Button>
        </form>
      )}
    </Sheet>
  );
}

function ProfileScanner({ onResult, onCancel }: { onResult: (v: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let done = false;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromVideoDevice(undefined, video.current!, (res) => {
          if (res && !done) { done = true; controls.stop(); onResult(res.getText()); }
        });
        stop = () => controls.stop();
      } catch {
        setErr("Caméra indisponible. Autorisez l'accès ou saisissez l'identifiant.");
      }
    })();
    return () => stop?.();
  }, [onResult]);
  return (
    <div>
      <div className="relative aspect-square overflow-hidden rounded-3xl bg-ink">
        <video ref={video} className="size-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-10 rounded-3xl border-4 border-lime/90" />
      </div>
      {err && <p className="mt-3 text-sm font-semibold text-err">{err}</p>}
      <Button block variant="ghost" className="mt-3" onClick={onCancel}>Saisir à la main</Button>
    </div>
  );
}
