import Link from "next/link";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { DishImage } from "@/components/app/dish-image";
import { SERVICE_LABEL, relativeDay } from "@/lib/format";
import { displayStatus, STATUS_META } from "@/lib/tickets";
import type { Ticket } from "@/lib/types";

export function TicketRow({ t }: { t: Ticket }) {
  const st = displayStatus(t);
  const meta = STATUS_META[st];
  const clickable = st === "valid";
  const body = (
    <div className={clsx("flex items-center gap-3 rounded-[20px] bg-card p-2.5 pr-3 shadow-[var(--shadow-card)]", !clickable && "opacity-90")}>
      <div className="relative">
        <DishImage name={t.dish.name} src={t.dish.photo_url} className={clsx("size-16", st !== "valid" && "grayscale-[60%]")} />
        <span className={clsx("absolute -right-1 -top-1 size-4 rounded-full ring-[3px] ring-card", meta.dot)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">{t.dish.name}</p>
        <p className="mt-0.5 text-[13px] text-muted">{relativeDay(t.service_date)} · {SERVICE_LABEL[t.service]}</p>
        <span className={clsx("mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold", meta.chip)}>{meta.label}</span>
      </div>
      {clickable && <ChevronRight className="size-5 text-off" />}
    </div>
  );
  return clickable ? <Link href={`/app/tickets/${t.id}`} className="block transition active:scale-[0.98]">{body}</Link> : body;
}
