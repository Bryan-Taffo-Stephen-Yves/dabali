"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Copy, Plus, Send, Globe, Trash2, Clock } from "lucide-react";
import { ServiceIcon } from "@/components/app/service-icon";
import { SERVICES, type ServiceKind } from "@/lib/types";
import { rpc, supabase } from "@/lib/supabase/client";
import { Card, PageTitle, Badge, input } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useStaff } from "@/components/admin/admin-shell";
import { addDays, dayShort, dayNum, duration, todayISO, weekStart, dateTime, SERVICE_LABEL } from "@/lib/format";

type Menu = { id: string; week_start: string; status: "draft" | "submitted" | "published"; submitted_at: string | null; published_at: string | null };
type Item = { id: string; service_date: string; service: ServiceKind; dish_id: string; price: number; planned_qty: number | null; sold_qty: number; served_qty: number; is_sold_out: boolean; is_full: boolean; dish: { name: string } };
type DishOpt = { id: string; name: string; base_price: number };

const STATUS: Record<Menu["status"], { label: string; tone: "gray" | "warn" | "ok" }> = {
  draft: { label: "Brouillon", tone: "gray" }, submitted: { label: "Soumis", tone: "warn" }, published: { label: "Publié", tone: "ok" },
};

export default function MenuPlanner() {
  const toast = useToast();
  const me = useStaff();
  const [week, setWeek] = useState(() => addDays(weekStart(todayISO()), 7));
  const [menu, setMenu] = useState<Menu | null | undefined>(undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [dishes, setDishes] = useState<DishOpt[]>([]);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const days = useMemo(() => Array.from({ length: 6 }, (_, i) => addDays(week, i)), [week]);

  const load = useCallback(async () => {
    const sb = supabase();
    const [{ data: m }, { data: dl }] = await Promise.all([
      sb.from("menus").select("id, week_start, status, submitted_at, published_at").eq("week_start", week).maybeSingle(),
      sb.rpc("menu_deadline", { p_week_start: week }),
    ]);
    setMenu(m as Menu | null);
    setDeadline(dl as string);
    if (m) {
      const { data } = await sb.from("menu_items")
        .select("id, service_date, service, dish_id, price, planned_qty, sold_qty, served_qty, is_sold_out, is_full, dish:dishes(name)")
        .eq("menu_id", m.id).order("price", { ascending: false });
      setItems((data ?? []) as unknown as Item[]);
    } else setItems([]);
  }, [week]);

  useEffect(() => { setMenu(undefined); load(); }, [load]);
  useEffect(() => {
    supabase().from("dishes").select("id, name, base_price").eq("is_active", true).order("name").then(({ data }) => setDishes(data ?? []));
  }, []);

  async function createMenu() {
    const { error } = await supabase().from("menus").insert({ week_start: week });
    if (error) return toast("err", "Création impossible.");
    load();
  }
  async function copyPrev() {
    setBusy(true);
    const r = await rpc<{ copied: number }>("copy_menu_week", { p_week_start: week });
    setBusy(false);
    if (!r.ok) return toast("err", r.message);
    toast("ok", `${r.copied} plats copiés depuis la semaine précédente.`);
    load();
  }
  async function act(fn: "submit_menu" | "publish_menu") {
    if (!menu) return;
    setBusy(true);
    const r = await rpc(fn, { p_menu_id: menu.id });
    setBusy(false);
    if (!r.ok) return toast("err", r.message);
    toast("ok", fn === "submit_menu" ? "Menu soumis à l'administration." : "Menu publié : les clients sont notifiés.");
    load();
  }
  async function addItem(date: string, service: ServiceKind, dishId: string) {
    const d = dishes.find((x) => x.id === dishId);
    if (!d || !menu) return;
    const { error } = await supabase().from("menu_items").insert({
      menu_id: menu.id, service_date: date, service, dish_id: d.id, price: d.base_price,
      planned_qty: { breakfast: 25, lunch: 30, snack: 20, dinner: 20 }[service],
    });
    if (error) return toast("err", error.code === "23505" ? "Ce plat est déjà au menu de ce service." : "Ajout impossible.");
    load();
  }
  async function patch(id: string, values: Partial<Item>) {
    setItems((l) => l.map((i) => (i.id === id ? { ...i, ...values } : i)));
    const { error } = await supabase().from("menu_items").update(values).eq("id", id);
    if (error) { toast("err", "Modification refusée."); load(); }
  }
  async function remove(id: string) {
    const { error, count } = await supabase().from("menu_items").delete({ count: "exact" }).eq("id", id);
    if (error || !count) return toast("err", "Impossible : des tickets ont déjà été vendus pour ce plat.");
    load();
  }

  const late = deadline ? Date.now() > new Date(deadline).getTime() : false;
  const isAdmin = me?.role === "admin";
  const canPublish = menu && menu.status !== "published" && (!late || isAdmin);

  return (
    <>
      <PageTitle title="Menu hebdomadaire" subtitle="Planifiez les plats, prix et quantités prévues par service">
        <div className="flex items-center gap-1 rounded-full border border-line bg-card p-1">
          <button onClick={() => setWeek(addDays(week, -7))} className="grid size-8 place-items-center rounded-full hover:bg-canvas" aria-label="Semaine précédente"><ChevronLeft className="size-4" /></button>
          <span className="px-2 text-sm font-bold">Semaine du {dayNum(week)}/{week.slice(5, 7)}</span>
          <button onClick={() => setWeek(addDays(week, 7))} className="grid size-8 place-items-center rounded-full hover:bg-canvas" aria-label="Semaine suivante"><ChevronRight className="size-4" /></button>
        </div>
      </PageTitle>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          {menu ? <Badge tone={STATUS[menu.status].tone}>{STATUS[menu.status].label}</Badge> : <Badge>Aucun menu</Badge>}
          {deadline && menu?.status !== "published" && (
            <span className={clsx("flex items-center gap-1.5 text-sm font-semibold", late ? "text-err" : "text-ink-2")}>
              <Clock className="size-4" />
              {late ? `Date limite dépassée (${dateTime(deadline)})${isAdmin ? " · seul l'admin peut publier" : ""}` : `Date limite dans ${duration(new Date(deadline).getTime() - Date.now())} (${dateTime(deadline)})`}
            </span>
          )}
          {menu?.status === "published" && menu.published_at && <span className="text-sm text-muted">Publié le {dateTime(menu.published_at)}</span>}
          <div className="ml-auto flex flex-wrap gap-2">
            {menu === null && <Button size="sm" variant="outline" onClick={createMenu}><Plus className="size-4" />Menu vide</Button>}
            {(menu === null || menu?.status === "draft") && <Button size="sm" variant="outline" loading={busy} onClick={copyPrev}><Copy className="size-4" />Copier la semaine précédente</Button>}
            {menu?.status === "draft" && <Button size="sm" variant="dark" loading={busy} onClick={() => act("submit_menu")}><Send className="size-4" />Soumettre</Button>}
            {canPublish && <Button size="sm" loading={busy} onClick={() => act("publish_menu")}><Globe className="size-4" />Publier</Button>}
          </div>
        </div>
      </Card>

      {menu === undefined && <div className="h-96 animate-pulse rounded-[22px] bg-card" />}
      {menu && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {days.map((d) => (
            <Card key={d} pad={false} className="overflow-hidden">
              <div className={clsx("flex items-center justify-between px-4 py-3", d === todayISO() ? "bg-lime" : "bg-canvas")}>
                <p className="font-extrabold">{dayShort(d)} {dayNum(d)}</p>
                <span className="text-xs font-bold text-muted">{items.filter((i) => i.service_date === d).length} plats</span>
              </div>
              {SERVICES.map((s) => {
                const list = items.filter((i) => i.service_date === d && i.service === s);
                return (
                  <div key={s} className="border-t border-line px-3 py-3">
                    <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-extrabold uppercase tracking-wider text-muted">
                      <ServiceIcon service={s} className="size-3.5" />{SERVICE_LABEL[s]}
                    </p>
                    <div className="space-y-1.5">
                      {list.map((i) => {
                        const out = i.is_sold_out || i.is_full;
                        return (
                          <div key={i.id} className={clsx("rounded-xl border px-2.5 py-2", out ? "border-err/30 bg-err-soft/50" : "border-line")}>
                            <div className="flex items-center gap-2">
                              <p className="flex-1 truncate text-sm font-bold">{i.dish.name}</p>
                              <button onClick={() => patch(i.id, { is_sold_out: !i.is_sold_out })} title="Déclarer une rupture"
                                className={clsx("rounded-full px-2 py-0.5 text-[11px] font-extrabold", i.is_sold_out ? "bg-err text-white" : i.is_full ? "bg-warn text-white" : "bg-canvas text-muted hover:bg-err-soft hover:text-err")}>
                                {i.is_sold_out ? "Épuisé" : i.is_full ? "Complet" : "Rupture ?"}
                              </button>
                              {i.sold_qty === 0 && <button onClick={() => remove(i.id)} aria-label="Retirer" className="text-off hover:text-err"><Trash2 className="size-4" /></button>}
                            </div>
                            <div className="mt-1.5 flex items-center gap-2 text-xs">
                              <label className="flex items-center gap-1 text-muted">Prévu
                                <input type="number" defaultValue={i.planned_qty ?? ""} min={0} className="h-7 w-14 rounded-lg border border-line px-1.5 text-right font-bold text-ink"
                                  onBlur={(e) => { const v = e.target.value === "" ? null : +e.target.value; if (v !== i.planned_qty) patch(i.id, { planned_qty: v }); }} />
                              </label>
                              <span className="ml-auto font-semibold text-muted" title="portions servies">{i.served_qty} servis</span>
                            </div>
                          </div>
                        );
                      })}
                      <select value="" onChange={(e) => addItem(d, s, e.target.value)} className={clsx(input, "h-9 w-full text-muted")}>
                        <option value="">+ Ajouter un plat…</option>
                        {dishes.filter((x) => !list.some((i) => i.dish_id === x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </div>
                  </div>
                );
              })}
            </Card>
          ))}
        </div>
      )}
      {menu === null && (
        <Card><p className="py-10 text-center text-sm font-semibold text-muted">Aucun menu pour cette semaine. Créez-le ou copiez la semaine précédente.</p></Card>
      )}
    </>
  );
}
