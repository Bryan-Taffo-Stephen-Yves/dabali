import { Coffee, Cookie, Moon, Sun, type LucideProps } from "lucide-react";
import clsx from "clsx";
import type { ServiceKind } from "@/lib/types";

const ICONS = { breakfast: Coffee, lunch: Sun, snack: Cookie, dinner: Moon };

/** Couleurs douces par type de ticket (fond + encre), pour repérer un ticket d'un coup d'œil */
export const SERVICE_TONE: Record<ServiceKind, string> = {
  breakfast: "bg-[#FEF3C7] text-[#92400E]",
  lunch: "bg-lime-soft text-[#4D6B05]",
  snack: "bg-[#FCE7F3] text-[#9D174D]",
  dinner: "bg-[#E0E7FF] text-[#3730A3]",
};

export function ServiceIcon({ service, ...p }: { service: ServiceKind } & LucideProps) {
  const I = ICONS[service] ?? Sun;
  return <I {...p} />;
}

export function ServiceBadge({ service, className, size = "size-12" }: { service: ServiceKind; className?: string; size?: string }) {
  return (
    <span className={clsx("grid shrink-0 place-items-center rounded-2xl", size, SERVICE_TONE[service], className)}>
      <ServiceIcon service={service} className="size-[45%]" strokeWidth={2.2} />
    </span>
  );
}
