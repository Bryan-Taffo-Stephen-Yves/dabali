import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

export function Card({ title, subtitle, action, className, children, pad = true }: {
  title?: string; subtitle?: string; action?: React.ReactNode; className?: string; children: React.ReactNode; pad?: boolean;
}) {
  return (
    // min-w-0 : dans une grille, la carte ne s'élargit pas au-delà de l'écran à cause d'un tableau ou d'une longue ligne
    <section className={clsx("min-w-0 rounded-[22px] border border-line bg-card", pad && "p-5", className)}>
      {(title || action) && (
        <header className={clsx("mb-4 flex flex-wrap items-start justify-between gap-3", !pad && "px-5 pt-5")}>
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-extrabold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, hint, icon: I, tone }: { label: string; value: string; hint?: string; icon?: LucideIcon; tone?: "lime" | "dark" }) {
  return (
    <div className={clsx("rounded-[22px] border p-4",
      tone === "lime" ? "border-transparent bg-lime" : tone === "dark" ? "border-transparent bg-ink text-white" : "border-line bg-card")}>
      <div className="flex items-center justify-between">
        <p className={clsx("text-[13px] font-bold", tone === "dark" ? "text-white/60" : tone === "lime" ? "text-ink/70" : "text-muted")}>{label}</p>
        {I && <I className={clsx("size-4", tone === "dark" ? "text-lime" : "text-muted")} />}
      </div>
      <p className="mt-2 text-[26px] font-extrabold leading-none tracking-tight">{value}</p>
      {hint && <p className={clsx("mt-2 text-xs font-semibold", tone === "dark" ? "text-white/60" : tone === "lime" ? "text-ink/70" : "text-muted")}>{hint}</p>}
    </div>
  );
}

export function PageTitle({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Badge({ tone = "gray", children }: { tone?: "gray" | "ok" | "warn" | "err" | "lime" | "dark"; children: React.ReactNode }) {
  const c = {
    gray: "bg-canvas text-ink-2", ok: "bg-ok-soft text-[#15803d]", warn: "bg-warn-soft text-[#b45309]",
    err: "bg-err-soft text-err", lime: "bg-lime text-ink", dark: "bg-ink text-white",
  }[tone];
  return <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold", c)}>{children}</span>;
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex rounded-full border border-line bg-card p-1">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)}
          className={clsx("h-8 rounded-full px-3.5 text-sm font-bold transition", value === v ? "bg-ink text-white" : "text-muted hover:text-ink")}>
          {l}
        </button>
      ))}
    </div>
  );
}

export const input = "h-10 rounded-xl border border-line bg-card px-3 text-sm font-medium outline-none focus:border-ink focus:ring-4 focus:ring-lime/40";

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border-2 border-dashed border-line p-8 text-center text-sm font-semibold text-muted">{children}</p>;
}

export function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}
