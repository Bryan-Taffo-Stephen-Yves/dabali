import clsx from "clsx";

/** Logo Dabali : un bol stylisé + le mot-symbole */
export function Logo({ className, mark = false }: { className?: string; mark?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 40 40" className="size-9" aria-hidden>
        <rect width="40" height="40" rx="12" fill="#16181D" />
        <path d="M9 19h22a11 11 0 0 1-22 0Z" fill="#C8F135" />
        <path d="M15 14c0-2 2-2 2-4M20 14c0-2 2-2 2-4M25 14c0-2 2-2 2-4" stroke="#C8F135" strokeWidth="2" strokeLinecap="round" fill="none" />
      </svg>
      {!mark && <span className="text-[22px] font-extrabold tracking-tight">dabali</span>}
    </span>
  );
}
