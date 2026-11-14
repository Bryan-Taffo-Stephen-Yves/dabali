"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, MessageCircle, XCircle } from "lucide-react";
import { rpc, supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/app/page-header";
import { DishImage } from "@/components/app/dish-image";
import { BiometricConfirm } from "@/components/app/biometric-confirm";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAppData } from "@/components/app/app-data";
import { buzz } from "@/lib/confetti";
import { syncTokens } from "@/lib/tickets";
import { fcfa, relativeDay, time } from "@/lib/format";

type Req = {
  token: string; status: "pending" | "done" | "cancelled"; pickup_at: string; expires_at: string; ticket_id: string | null; extra_ids: string[];
  item: { price: number; service_date: string; dish: { name: string; photo_url: string | null } | null } | null;
};

/** Commande préparée par Jean sur WhatsApp : le client la confirme ici avec son code PIN (jamais dans WhatsApp). */
export default function ConfirmOrder({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { refresh, profile } = useAppData();
  const [req, setReq] = useState<Req | null | undefined>(undefined);
  const [extras, setExtras] = useState<{ id: string; name: string; price: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase().from("order_requests")
      .select("token, status, pickup_at, expires_at, ticket_id, extra_ids, item:menu_items(price, service_date, dish:dishes(name, photo_url))")
      .eq("token", token).maybeSingle()
      .then(async ({ data }) => {
        const r = data as unknown as Req | null;
        setReq(r);
        if (r?.status === "done" && r.ticket_id) router.replace(`/app/tickets/${r.ticket_id}`);
        if (r?.extra_ids?.length) {
          const { data: ex } = await supabase().from("extras").select("id, name, price").in("id", r.extra_ids);
          setExtras(ex ?? []);
        }
      });
  }, [token, router]);

  async function confirm(pin: string) {
    setBusy(true); setErr(null);
    const r = await rpc<{ ticket_id: string; order_no: number }>("confirm_order_request", { p_token: token, p_pin: pin });
    setBusy(false);
    if (!r.ok) {
      if (r.code === "PIN_NOT_SET") { router.push(`/app/profil?pin=new&back=/app/confirmer/${token}`); return; }
      setErr(r.message); return;
    }
    buzz([20, 60, 40]); refresh();
    toast("ok", r.order_no ? `Commande n° ${r.order_no} confirmée ✅` : "Commande confirmée ✅");
    await syncTokens();
    router.replace(`/app/tickets/${r.ticket_id}`);
  }

  async function cancel() {
    await rpc("cancel_order_request", { p_token: token });
    toast("ok", "Demande annulée."); router.replace("/app");
  }

  const expired = req && (req.status !== "pending" || new Date(req.expires_at).getTime() < Date.now());
  const total = (req?.item?.price ?? 0) + extras.reduce((s, e) => s + e.price, 0);
  return (
    <main className="pb-10">
      <PageHeader title="Confirmer ma commande" />
      <div className="px-4">
        {req === undefined && <div className="h-40 animate-pulse rounded-[24px] bg-card" />}
        {req === null && (
          <div className="rounded-[24px] border-2 border-dashed border-line p-8 text-center">
            <XCircle className="mx-auto size-10 text-err" />
            <p className="mt-2 font-bold">Demande introuvable sur ce compte</p>
            <p className="mt-1 text-sm text-muted">Vérifie que tu es connecté avec le même compte que celui lié à WhatsApp.</p>
          </div>
        )}
        {req && (
          <>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-muted"><MessageCircle className="size-4 text-[#128C7E]" />Préparée par Jean sur WhatsApp</p>
            <div className="mt-3 flex items-center gap-3 rounded-[24px] bg-card p-3 shadow-[var(--shadow-card)]">
              <DishImage name={req.item?.dish?.name ?? ""} src={req.item?.dish?.photo_url ?? null} className="size-20 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-lg font-extrabold leading-tight">{req.item?.dish?.name}</p>
                {extras.length > 0 && <p className="text-sm font-bold text-ink-2">+ {extras.map((e) => e.name).join(" + ")}</p>}
                <p className="mt-1 flex items-center gap-1 text-sm font-bold text-lime-deep"><Clock className="size-4" />Retrait {relativeDay(req.pickup_at.slice(0, 10)).toLowerCase()} à {time(req.pickup_at)}</p>
              </div>
              <p className="text-lg font-extrabold">{fcfa(total)}</p>
            </div>
            {expired ? (
              <p className="mt-5 rounded-2xl bg-warn-soft px-4 py-3 text-center text-sm font-bold">Cette demande a expiré ou a déjà été traitée. Redemande à Jean.</p>
            ) : (
              <>
                <p className="mb-3 mt-6 text-center text-sm font-semibold text-muted">{profile?.biometric_enabled ? "Confirme et paie d'un regard." : "Tape ton code PIN pour confirmer et payer."}</p>
                <BiometricConfirm enabled={!!profile?.biometric_enabled} mode="send" onConfirmed={confirm} pinError={err} busy={busy} />
                <Button variant="ghost" block className="mt-3 text-err" onClick={cancel}>Ce n&apos;est pas moi / annuler</Button>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
