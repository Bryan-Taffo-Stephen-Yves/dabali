"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { supabase } from "@/lib/supabase/client";
import { Card, PageTitle, input } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { SERVICES, type ServiceKind } from "@/lib/types";

type Settings = {
  services: Record<ServiceKind, { label: string; start: string; end: string; price: number; extras: boolean }>;
  ticket_validity_hours: number;
  menu_deadline: { weekday: number; time: string };
  cancel_cutoff_minutes: number;
  presale_days: number;
  pin_threshold: number;
  transfer_limits: { min: number; max: number; daily_max: number };
  recharge_limits: { min: number; max: number };
  loyalty: { points_per_ticket: number; reward_points: number; reward_service?: ServiceKind };
  low_balance_threshold: number;
  service_days: number[];
};
type Extra = { id: string; name: string; price: number; kind: string; is_active: boolean };
type Cat = { id: number; name: string; sort: number };
const DAYS = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export default function SettingsPage() {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sb = supabase();
    sb.from("settings").select("key, value").then(({ data }) => setS(Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Settings));
    sb.from("extras").select("id, name, price, kind, is_active").order("sort").then(({ data }) => setExtras(data ?? []));
    sb.from("categories").select("id, name, sort").order("sort").then(({ data }) => setCats(data ?? []));
  }, []);

  async function save() {
    if (!s) return;
    setBusy(true);
    const sb = supabase();
    const results = await Promise.all([
      ...Object.entries(s).map(([key, value]) => sb.from("settings").update({ value }).eq("key", key)),
      ...extras.map((e) => sb.from("extras").update({ name: e.name, price: e.price, is_active: e.is_active }).eq("id", e.id)),
      ...cats.map((c) => sb.from("categories").update({ name: c.name }).eq("id", c.id)),
    ]);
    setBusy(false);
    if (results.some((r) => r.error)) return toast("err", "Certaines valeurs n'ont pas été enregistrées.");
    toast("ok", "Paramètres enregistrés.");
  }

  if (!s) return <div className="h-96 animate-pulse rounded-[22px] bg-card" />;
  const set = (patch: Partial<Settings>) => setS({ ...s, ...patch });
  const setSvc = (k: ServiceKind, patch: Partial<Settings["services"][ServiceKind]>) =>
    setS({ ...s, services: { ...s.services, [k]: { ...s.services[k], ...patch } } });
  return (
    <>
      <PageTitle title="Paramètres"><Button loading={busy} onClick={save}>Enregistrer</Button></PageTitle>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Tickets par type de repas" subtitle="Horaires du service, prix du ticket, suppléments autorisés">
          {SERVICES.map((k) => (
            <div key={k} className="border-b border-line py-3 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold">{s.services[k]?.label ?? k}</p>
                <span className="flex items-center gap-2">
                  <input type="time" value={s.services[k]?.start ?? ""} onChange={(e) => setSvc(k, { start: e.target.value })} className={input} />
                  <span className="text-muted">→</span>
                  <input type="time" value={s.services[k]?.end ?? ""} onChange={(e) => setSvc(k, { end: e.target.value })} className={input} />
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <N value={s.services[k]?.price ?? 0} onChange={(v) => setSvc(k, { price: v })} suffix="FCFA le ticket" />
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={!!s.services[k]?.extras} onChange={(e) => setSvc(k, { extras: e.target.checked })} className="size-4 accent-[#16181D]" />
                  Entrée / dessert en supplément
                </label>
              </div>
            </div>
          ))}
          <Row label="Validité d'un ticket" hint="à partir de l'achat"><N value={s.ticket_validity_hours ?? 48} onChange={(v) => set({ ticket_validity_hours: v })} suffix="heures" /></Row>
          <Row label="Jours de service">
            <span className="flex gap-1">{[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button key={d} onClick={() => set({ service_days: s.service_days.includes(d) ? s.service_days.filter((x) => x !== d) : [...s.service_days, d].sort() })}
                className={clsx("size-9 rounded-lg text-xs font-bold", s.service_days.includes(d) ? "bg-ink text-white" : "bg-canvas")}>{DAYS[d]}</button>
            ))}</span>
          </Row>
        </Card>
        <Card title="Menu hebdomadaire">
          <Row label="Date limite de soumission" hint="semaine précédente">
            <span className="flex items-center gap-2">
              <select value={s.menu_deadline.weekday} onChange={(e) => set({ menu_deadline: { ...s.menu_deadline, weekday: +e.target.value } })} className={input}>
                {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}
              </select>
              <input type="time" value={s.menu_deadline.time} onChange={(e) => set({ menu_deadline: { ...s.menu_deadline, time: e.target.value } })} className={input} />
            </span>
          </Row>
          <p className="pt-2 text-xs text-muted">Rappel automatique au chef le mardi ; alerte à l&apos;admin si le menu n&apos;est pas soumis à temps.</p>
        </Card>
        <Card title="Argent et sécurité">
          <Row label="PIN exigé au-delà de"><N value={s.pin_threshold} onChange={(v) => set({ pin_threshold: v })} suffix="FCFA" /></Row>
          <Row label="Transfert minimum"><N value={s.transfer_limits.min} onChange={(v) => set({ transfer_limits: { ...s.transfer_limits, min: v } })} suffix="FCFA" /></Row>
          <Row label="Transfert maximum"><N value={s.transfer_limits.max} onChange={(v) => set({ transfer_limits: { ...s.transfer_limits, max: v } })} suffix="FCFA" /></Row>
          <Row label="Plafond journalier"><N value={s.transfer_limits.daily_max} onChange={(v) => set({ transfer_limits: { ...s.transfer_limits, daily_max: v } })} suffix="FCFA" /></Row>
          <Row label="Alerte solde bas"><N value={s.low_balance_threshold} onChange={(v) => set({ low_balance_threshold: v })} suffix="FCFA" /></Row>
        </Card>
        <Card title="Fidélité">
          <Row label="Points par repas servi"><N value={s.loyalty.points_per_ticket} onChange={(v) => set({ loyalty: { ...s.loyalty, points_per_ticket: v } })} /></Row>
          <Row label="Points pour un ticket offert"><N value={s.loyalty.reward_points} onChange={(v) => set({ loyalty: { ...s.loyalty, reward_points: v } })} /></Row>
          <Row label="Ticket offert">
            <select value={s.loyalty.reward_service ?? "breakfast"} onChange={(e) => set({ loyalty: { ...s.loyalty, reward_service: e.target.value as ServiceKind } })} className={input}>
              {SERVICES.map((k) => <option key={k} value={k}>{s.services[k]?.label ?? k}</option>)}
            </select>
          </Row>
        </Card>
        <Card title="Suppléments (entrées, desserts)">
          {extras.map((e, i) => (
            <Row key={e.id} label="">
              <span className="flex w-full items-center gap-2">
                <input value={e.name} onChange={(ev) => setExtras(extras.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))} className={clsx(input, "flex-1")} />
                <input type="number" value={e.price} onChange={(ev) => setExtras(extras.map((x, j) => (j === i ? { ...x, price: +ev.target.value } : x)))} className={clsx(input, "w-24 text-right")} />
                <label className="flex items-center gap-1 text-xs font-bold"><input type="checkbox" checked={e.is_active} onChange={(ev) => setExtras(extras.map((x, j) => (j === i ? { ...x, is_active: ev.target.checked } : x)))} />actif</label>
              </span>
            </Row>
          ))}
        </Card>
        <Card title="Catégories">
          {cats.map((c, i) => (
            <Row key={c.id} label="">
              <input value={c.name} onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={clsx(input, "w-full")} />
            </Row>
          ))}
        </Card>
      </div>
    </>
  );
}

function N({ value, onChange, suffix }: { value: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <span className="flex items-center gap-2">
      <input type="number" value={value} onChange={(e) => onChange(+e.target.value)} className={clsx(input, "w-28 text-right font-bold")} />
      {suffix && <span className="text-sm text-muted">{suffix}</span>}
    </span>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-0">
      {label ? <div><p className="text-sm font-bold">{label}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div> : null}
      {children}
    </div>
  );
}
