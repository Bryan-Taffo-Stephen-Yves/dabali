import Link from "next/link";
import clsx from "clsx";
import { ChevronRight, QrCode } from "lucide-react";
import { ServiceBadge } from "@/components/app/service-icon";
import { SERVICE_LABEL, relativeDay, shortDateTime, time } from "@/lib/format";
import { displayStatus, isOrder, orderDish, orderStep, PREP_STEPS, STATUS_META } from "@/lib/tickets";
import type { Ticket } from "@/lib/types";

/** Ligne de ticket : type de repas, validité ou plat servi. Un ticket valide ouvre son QR. */
export function TicketRow({ t }: { t: Ticket }) {
  const st = displayStatus(t);
  const meta = STATUS_META[st];
  const clickable = st === "valid";
  const order = isOrder(t);
  const dish = order ? orderDish(t) : null;
  const sub = order
    ? st === "valid" ? `Retrait ${relativeDay(t.pickup_at!.slice(0, 10)).toLowerCase()} à ${time(t.pickup_at!)} · ${PREP_STEPS[orderStep(t)]}`
      : st === "used" ? `Récupérée${t.used_at ? ` · ${shortDateTime(t.used_at)}` : ""}`
      : st === "expired" ? "Non récupérée · plat perdu" : "Annulée et remboursée"
    : st === "valid" ? `Valable jusqu'au ${shortDateTime(t.valid_until)}`
    : st === "used" ? (t.dish ? `Servi : ${t.dish.name}` : "Utilisé") + (t.used_at ? ` · ${shortDateTime(t.used_at)}` : "")
    : st === "expired" ? `Expiré le ${shortDateTime(t.valid_until)} · remboursé`
    : "Annulé et remboursé";
  const body = (
    <div className={clsx("flex items-center gap-3 rounded-[20px] bg-card p-3 pr-3.5 shadow-[var(--shadow-card)]", !clickable && "opacity-80")}>
      <div className="relative">
        <ServiceBadge service={t.service} size="size-14" className={clsx(!clickable && "grayscale-[70%]")} />
        <span className={clsx("absolute -right-1 -top-1 size-4 rounded-full ring-[3px] ring-card", meta.dot)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">{order ? <>Commande n° {t.order_no} · {dish?.name}</> : <>Ticket {SERVICE_LABEL[t.service]}{t.is_reward && " 🎁"}</>}</p>
        <p className="mt-0.5 truncate text-[13px] text-muted">{sub}</p>
        {t.gift_from && <p className="mt-0.5 truncate text-[12px] font-bold text-lime-deep">🎁 Offert par {t.gift_from}</p>}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {order && st === "valid" && t.prep_status === "ready"
            ? <span className="rounded-full bg-lime px-2 py-0.5 text-[11px] font-extrabold text-ink">Prête 🍽️</span>
            : <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-bold", meta.chip)}>{order && st === "valid" ? "Commande" : meta.label}</span>}
          {t.extras.map((e) => <span key={e.id} className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-ink-2">+ {e.name}</span>)}
        </div>
      </div>
      {clickable && (
        <span className="grid size-10 place-items-center rounded-xl bg-ink text-lime"><QrCode className="size-5" /></span>
      )}
      {!clickable && <ChevronRight className="size-5 text-transparent" />}
    </div>
  );
  return clickable ? <Link href={`/app/tickets/${t.id}`} className="block transition active:scale-[0.98]">{body}</Link> : body;
}
