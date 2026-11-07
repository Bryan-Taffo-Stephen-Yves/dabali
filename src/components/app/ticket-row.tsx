import Link from "next/link";
import clsx from "clsx";
import { ChevronRight, QrCode } from "lucide-react";
import { ServiceBadge } from "@/components/app/service-icon";
import { SERVICE_LABEL, shortDateTime } from "@/lib/format";
import { displayStatus, STATUS_META } from "@/lib/tickets";
import type { Ticket } from "@/lib/types";

/** Ligne de ticket : type de repas, validité ou plat servi. Un ticket valide ouvre son QR. */
export function TicketRow({ t }: { t: Ticket }) {
  const st = displayStatus(t);
  const meta = STATUS_META[st];
  const clickable = st === "valid";
  const sub =
    st === "valid" ? `Valable jusqu'au ${shortDateTime(t.valid_until)}`
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
        <p className="truncate font-bold">Ticket {SERVICE_LABEL[t.service]}{t.is_reward && " 🎁"}</p>
        <p className="mt-0.5 truncate text-[13px] text-muted">{sub}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-bold", meta.chip)}>{meta.label}</span>
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
