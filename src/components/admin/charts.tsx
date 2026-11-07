"use client";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

// Graphiques SVG légers, une seule série (pas de légende : le titre de la carte la nomme).
// Marques fines, bouts arrondis côté donnée, grille discrète, info-bulle au survol.

const INK = "#3A3F4B";
const ACCENT = "#8FB515";
const GRID = "#EEF0F3";

/** Largeur réelle du conteneur : le texte des axes garde sa taille quelle que soit la largeur d'écran */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const compact = (n: number) => (n >= 1_000_000 ? `${+(n / 1e6).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("fr-FR"));

export function Columns({ data, height = 180, highlight, format = (n: number) => String(n), label = (l: string) => l, every = 1 }: {
  data: { label: string; value: number }[]; height?: number; highlight?: number;
  format?: (n: number) => string; label?: (l: string) => string; every?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const H = height, L = 40, B = 22, T = 10;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const slot = (W - L) / Math.max(data.length, 1);
  const bw = Math.min(24, slot * 0.6);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const hi = hover ?? null;
  return (
    <div ref={ref} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full" role="img" aria-label="Histogramme">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="fill-muted text-[11px]">{compact(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = L + i * slot + (slot - bw) / 2, top = y(d.value), h = Math.max(0, y(0) - top);
          const r = Math.min(4, h);
          const color = i === highlight ? ACCENT : INK;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + i * slot} y={T} width={slot} height={H - T - B} fill="transparent" />
              {h > 0 && <path d={`M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${y(0)} Z`}
                fill={color} opacity={hi === null || hi === i ? 1 : 0.45} />}
              {i % every === 0 && <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="fill-muted text-[11px]">{label(d.label)}</text>}
            </g>
          );
        })}
      </svg>
      {hi !== null && data[hi] && (
        <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-xl bg-ink px-2.5 py-1.5 text-xs font-bold text-white shadow-lg"
          style={{ left: `${((L + hi * slot + slot / 2) / W) * 100}%`, top: `${(y(data[hi].value) / H) * 100}%` }}>
          {label(data[hi].label)} · {format(data[hi].value)}
        </div>
      )}
    </div>
  );
}

export function AreaLine({ data, height = 180, max: fixedMax, format = (n: number) => String(n), xLabel }: {
  data: { x: number; label: string; value: number }[]; height?: number; max?: number;
  format?: (n: number) => string; xLabel?: (x: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const H = height, L = 40, B = 22, T = 10;
  if (data.length < 2) return <p className="py-10 text-center text-sm text-muted">Pas encore de données</p>;
  const xs = data.map((d) => d.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const max = fixedMax ?? niceMax(Math.max(...data.map((d) => d.value)));
  const px = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - 8);
  const py = (v: number) => T + (H - T - B) * (1 - v / max);
  const line = data.map((d, i) => `${i ? "L" : "M"}${px(d.x)},${py(d.value)}`).join(" ");
  const area = `${line} L${px(x1)},${py(0)} L${px(x0)},${py(0)} Z`;
  const hp = hover !== null ? data[hover] : null;
  const ticks = [0, max / 2, max];
  const xt = [0, 0.25, 0.5, 0.75, 1].map((f) => x0 + f * (x1 - x0));
  return (
    <div ref={ref} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full" role="img" aria-label="Courbe"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          data.forEach((d, i) => { if (Math.abs(px(d.x) - x) < Math.abs(px(data[best].x) - x)) best = i; });
          setHover(best);
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W} y1={py(t)} y2={py(t)} stroke={GRID} />
            <text x={L - 8} y={py(t) + 4} textAnchor="end" className="fill-muted text-[11px]">{format(t)}</text>
          </g>
        ))}
        {xLabel && xt.map((x) => <text key={x} x={px(x)} y={H - 6} textAnchor="middle" className="fill-muted text-[11px]">{xLabel(x)}</text>)}
        <path d={area} fill={ACCENT} opacity={0.12} />
        <path d={line} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hp && (
          <>
            <line x1={px(hp.x)} x2={px(hp.x)} y1={T} y2={py(0)} stroke={INK} strokeOpacity={0.25} />
            <circle cx={px(hp.x)} cy={py(hp.value)} r={5} fill={INK} stroke="#fff" strokeWidth={2} />
          </>
        )}
      </svg>
      {hp && (
        <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-[130%] rounded-xl bg-ink px-2.5 py-1.5 text-xs font-bold text-white"
          style={{ left: `${(px(hp.x) / W) * 100}%`, top: `${(py(hp.value) / H) * 100}%` }}>
          {hp.label} · {format(hp.value)}
        </div>
      )}
    </div>
  );
}

// Rampe séquentielle à une teinte (vert), du clair au foncé
const RAMP = ["#F4F9E4", "#E3F1B8", "#C8E27A", "#A6C93D", "#7E9E1B", "#566E0C"];

export function Heatmap({ rows, cols, value, rowLabel, colLabel, format }: {
  rows: number[]; cols: number[]; value: (r: number, c: number) => number | undefined;
  rowLabel: (r: number) => string; colLabel: (c: number) => string; format: (n: number) => string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const all = rows.flatMap((r) => cols.map((c) => value(r, c) ?? 0));
  const max = Math.max(...all, 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-[3px] text-[11px]">
        <thead><tr><th />{cols.map((c) => <th key={c} className="font-semibold text-muted">{colLabel(c)}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th className="pr-2 text-right font-semibold text-muted">{rowLabel(r)}</th>
              {cols.map((c) => {
                const v = value(r, c);
                const k = `${r}-${c}`;
                const idx = v ? Math.min(RAMP.length - 1, Math.floor((v / max) * (RAMP.length - 0.01))) : -1;
                return (
                  <td key={c} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}
                    title={`${rowLabel(r)} ${colLabel(c)} : ${v ? format(v) : "—"}`}
                    className={clsx("h-7 min-w-7 rounded-md text-center font-bold", hover === k && "ring-2 ring-ink")}
                    style={{ background: idx < 0 ? "#F6F7F9" : RAMP[idx], color: idx >= 4 ? "#fff" : "#16181D" }}>
                    {hover === k && v ? format(v) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-muted">
        Faible {RAMP.map((c) => <span key={c} className="size-3 rounded-sm" style={{ background: c }} />)} Fort
      </div>
    </div>
  );
}

export function Meter({ value, max, tone = "ink" }: { value: number; max: number; tone?: "ink" | "warn" | "err" | "ok" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const c = { ink: "bg-ink-2", warn: "bg-warn", err: "bg-err", ok: "bg-ok" }[tone];
  return <div className="h-2 overflow-hidden rounded-full bg-canvas"><div className={clsx("h-full rounded-full", c)} style={{ width: `${pct}%` }} /></div>;
}
