import clsx from "clsx";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "dark" | "ghost" | "outline" | "danger";
const styles: Record<Variant, string> = {
  primary: "bg-lime text-ink hover:brightness-95 active:brightness-90",
  dark: "bg-ink text-white hover:bg-ink-2",
  ghost: "bg-transparent text-ink hover:bg-ink/5",
  outline: "border border-line bg-card text-ink hover:bg-canvas",
  danger: "bg-err-soft text-err hover:bg-err/15",
};

type Common = { variant?: Variant; size?: "md" | "lg" | "sm"; block?: boolean; loading?: boolean };
const sizes = { sm: "h-9 px-3.5 text-sm", md: "h-11 px-5 text-[15px]", lg: "h-14 px-6 text-base" };

function cls({ variant = "primary", size = "md", block }: Common, extra?: string) {
  return clsx(
    "inline-flex select-none items-center justify-center gap-2 rounded-full font-bold transition",
    "disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
    styles[variant], sizes[size], block && "w-full", extra,
  );
}

export function Button({ variant, size, block, loading, className, children, disabled, ...p }: Common & ComponentProps<"button">) {
  return (
    <button className={cls({ variant, size, block }, className)} disabled={disabled || loading} {...p}>
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant, size, block, className, ...p }: Common & ComponentProps<typeof Link>) {
  return <Link className={cls({ variant, size, block }, className)} {...p} />;
}
