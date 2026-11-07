import clsx from "clsx";
import type { ComponentProps } from "react";

export function Field({ label, hint, error, className, ...p }: { label: string; hint?: string; error?: string | null } & ComponentProps<"input">) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1.5 block text-[13px] font-bold text-ink-2">{label}</span>
      <input
        className={clsx(
          "h-13 w-full rounded-2xl border bg-card px-4 text-[16px] font-medium outline-none transition placeholder:text-off",
          "focus:border-ink focus:ring-4 focus:ring-lime/40",
          error ? "border-err" : "border-line",
        )}
        {...p}
      />
      {(error || hint) && <span className={clsx("mt-1.5 block text-xs font-medium", error ? "text-err" : "text-muted")}>{error || hint}</span>}
    </label>
  );
}
