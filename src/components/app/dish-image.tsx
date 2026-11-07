"use client";
import { useState } from "react";
import clsx from "clsx";

// Visuel de repli élégant (dégradé + initiales) : quand il n'y a pas de photo, ou si elle ne charge pas
const PALETTES = [
  ["#FDE68A", "#F59E0B"], ["#FECACA", "#EF4444"], ["#D9F99D", "#65A30D"], ["#FED7AA", "#EA580C"],
  ["#BFDBFE", "#2563EB"], ["#E9D5FF", "#9333EA"], ["#A7F3D0", "#059669"], ["#FBCFE8", "#DB2777"],
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function DishImage({ name, src, className, rounded = "rounded-2xl" }: {
  name: string; src?: string | null; className?: string; rounded?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} loading="lazy" onError={() => setFailed(src)} className={clsx("bg-canvas object-cover", rounded, className)} />;
  }
  const [a, b] = PALETTES[hash(name) % PALETTES.length];
  const initials = name.split(/\s+/).filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div role="img" aria-label={name}
      className={clsx("relative grid place-items-center overflow-hidden", rounded, className)}
      style={{ background: `radial-gradient(120% 120% at 20% 10%, ${a} 0%, ${b} 100%)` }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full opacity-25" aria-hidden>
        <circle cx="50" cy="56" r="34" fill="none" stroke="white" strokeWidth="5" />
        <circle cx="50" cy="56" r="22" fill="white" fillOpacity=".35" />
      </svg>
      <span className="relative text-2xl font-extrabold text-white drop-shadow-sm">{initials}</span>
    </div>
  );
}
