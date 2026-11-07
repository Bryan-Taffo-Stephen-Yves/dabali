"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { RefreshCw, Plus, Send, Trash2, Zap, ShoppingCart, CheckCircle2, XCircle, Bot } from "lucide-react";
import { rpc, supabase } from "@/lib/supabase/client";
import { Card, PageTitle, Badge, Empty, Kpi, input } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { fcfa, dateTime } from "@/lib/format";
import { LIST_COLUMNS, STATUS_LABEL, fetchItems, listCode, qtyLabel, type ShoppingItem, type ShoppingList } from "@/lib/shopping";

type Staff = { id: string; full_name: string; role: string };
type Ing = { id: string; name: string; unit: string };
const ROLE: Record<string, string> = { agent: "Agent", caissier: "Caisse", chef: "Cuisine", admin: "Admin" };

export default function ShoppingAdmin() {
  const toast = useToast();
  const [lists, setLists] = useState<ShoppingList[] | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [ings, setIngs] = useState<Ing[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", qty: "", unit: "pièce" });
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase().from("shopping_lists").select(LIST_COLUMNS).order("created_at", { ascending: false }).limit(15);
    const l = (data ?? []) as unknown as ShoppingList[];
    setLists(l);
    setItems(await fetchItems(l.filter((x) => x.status !== "cancelled").slice(0, 8).map((x) => x.id)));
  }, []);

  useEffect(() => {
    rpc("shopping_refresh").then(load);
    supabase().rpc("shopping_staff").then(({ data }) => setStaff((data ?? []) as Staff[]));
    supabase().from("ingredients").select("id, name, unit").order("name").then(({ data }) => setIngs(data ?? []));
    const sb = supabase();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(load, 500); };
    const ch = sb.channel("shopping-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "shopping_items" }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "shopping_lists" }, soon).subscribe();
    return () => { clearTimeout(t); sb.removeChannel(ch); };
  }, [load]);

  const open = lists?.find((l) => l.status === "open");
  const active = lists?.filter((l) => l.status === "assigned" || l.status === "shopping") ?? [];
  const history = lists?.filter((l) => l.status === "done" || l.status === "cancelled") ?? [];
  const openItems = items.filter((i) => i.list_id === open?.id);
  const openTotal = openItems.reduce((s, i) => s + i.est_cost, 0);

  async function call(key: string, fn: string, args: Record<string, unknown>, ok?: string) {
    setBusy(key);
    const r = await rpc(fn, args);
    setBusy(null);
    if (!r.ok) { toast("err", r.message); return false; }
    if (ok) toast("ok", ok);
    load();
    return true;
  }

  async function add(listId?: string) {
    const ing = ings.find((i) => i.name.toLowerCase() === form.label.trim().toLowerCase());
    const done = await call("add", "shopping_add", {
      p_label: form.label, p_qty: Number(form.qty.replace(",", ".")), p_unit: ing?.unit ?? form.unit,
      p_ingredient_id: ing?.id ?? null, p_list_id: listId ?? null,
    }, listId ? "Ajout urgent envoyé à l'acheteur." : "Ajouté à la prochaine fiche.");
    if (done) setForm({ label: "", qty: "", unit: "pièce" });
  }

  async function assign() {
    if (!open || !assignee) return;
    const ok = await call("assign", "shopping_assign", { p_list_id: open.id, p_user_id: assignee, p_note: note || null });
    if (ok) { toast("ok", `Fiche ${listCode(open.num)} envoyée à ${staff.find((s) => s.id === assignee)?.full_name}.`); setNote(""); }
  }

  const addForm = (listId?: string) => (
    <div className="flex flex-wrap gap-2">
      <input list="ings" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Article (ex. frites surgelées)" className={clsx(input, "min-w-0 flex-1")} />
      <input value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} inputMode="decimal" placeholder="Qté" className={clsx(input, "w-20 text-right")} />
      {!ings.some((i) => i.name.toLowerCase() === form.label.trim().toLowerCase()) && (
        <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={clsx(input, "w-28")}>
          {["pièce", "paquet", "sachet", "kg", "L", "boîte", "carton", "botte"].map((u) => <option key={u}>{u}</option>)}
        </select>
      )}
      <Button size="sm" variant={listId ? "dark" : "outline"} loading={busy === "add"} disabled={!form.label.trim() || !form.qty} onClick={() => add(listId)}>
        {listId ? <Zap className="size-4" /> : <Plus className="size-4" />}{listId ? "Urgent" : "Ajouter"}
      </Button>
    </div>
  );

  return (
    <>
      <PageTitle title="Courses" subtitle="La fiche se remplit toute seule quand un stock baisse ; une seule sortie pour tout acheter">
        <Button size="sm" variant="outline" loading={busy === "refresh"} onClick={() => call("refresh", "shopping_refresh", {}, "Fiche recalculée.")}>
          <RefreshCw className="size-4" />Recalculer
        </Button>
      </PageTitle>
      <datalist id="ings">{ings.map((i) => <option key={i.id} value={i.name} />)}</datalist>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tone="dark" icon={ShoppingCart} label="Prochaine fiche" value={open ? `${openItems.length} articles` : "Vide"} hint={open ? listCode(open.num) : "rien à acheter"} />
        <Kpi tone="lime" label="Budget estimé" value={fcfa(openTotal)} hint="prix unitaires du stock" />
        <Kpi label="Courses en cours" value={String(active.length)} hint={active[0]?.assignee?.full_name ?? "personne dehors"} />
        <Kpi label="Dernière dépense" value={history[0]?.spent_total != null ? fcfa(history[0].spent_total) : "—"} hint={history[0]?.done_at ? dateTime(history[0].done_at) : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card title={open ? `Prochaine fiche · ${listCode(open.num)}` : "Prochaine fiche"} pad={false}
          subtitle="Lignes auto : stock sous le seuil ou menus des 2 prochains jours. Modifiez une quantité : elle ne sera plus recalculée.">
          <div className="divide-y divide-line">
            {lists === null && <div className="m-5 h-40 animate-pulse rounded-xl bg-canvas" />}
            {lists && openItems.length === 0 && <div className="p-5"><Empty>Rien à acheter pour l&apos;instant 👌</Empty></div>}
            {openItems.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-5 py-3">
                <span className={clsx("grid size-8 shrink-0 place-items-center rounded-lg", i.source === "auto" ? "bg-ink text-lime" : "bg-canvas")}>
                  {i.source === "auto" ? <Bot className="size-4" /> : <Plus className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{i.label}</p>
                  <p className="truncate text-xs text-muted">{i.reason}</p>
                </div>
                <input type="number" defaultValue={i.qty} step="0.5" min={0} key={`${i.id}-${i.qty}`}
                  onBlur={(e) => { const v = +e.target.value; if (v !== Number(i.qty)) call("qty", "shopping_set_qty", { p_item_id: i.id, p_qty: v }); }}
                  className="h-9 w-20 rounded-lg border border-line px-2 text-right text-sm font-bold" />
                <span className="w-12 text-xs text-muted">{i.unit}</span>
                <span className="hidden w-24 text-right text-sm font-semibold sm:block">{i.est_cost ? fcfa(i.est_cost) : "—"}</span>
                <button onClick={() => call("qty", "shopping_set_qty", { p_item_id: i.id, p_qty: 0 })} aria-label="Retirer" className="text-off hover:text-err"><Trash2 className="size-4" /></button>
              </div>
            ))}
          </div>
          <div className="space-y-3 border-t border-line bg-canvas/60 px-5 py-4">
            {addForm()}
            <div className="flex flex-wrap items-center gap-2">
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={clsx(input, "min-w-0 flex-1")}>
                <option value="">Qui fait les courses ?</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name} · {ROLE[s.role] ?? s.role}</option>)}
              </select>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Consigne (magasin, caisse…)" className={clsx(input, "min-w-0 flex-1")} />
              <Button size="sm" loading={busy === "assign"} disabled={!open || !openItems.length || !assignee} onClick={assign}><Send className="size-4" />Envoyer la fiche</Button>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          {active.map((l) => {
            const li = items.filter((i) => i.list_id === l.id);
            const done = li.filter((i) => i.status !== "todo").length;
            return (
              <Card key={l.id} title={`${listCode(l.num)} · ${l.assignee?.full_name ?? ""}`}
                subtitle={`${STATUS_LABEL[l.status]}${l.assigned_at ? ` depuis ${dateTime(l.assigned_at)}` : ""}`}
                action={<button onClick={() => confirm("Annuler cette fiche ? Les articles reviennent sur la prochaine fiche.") && call("cancel", "shopping_cancel", { p_list_id: l.id }, "Fiche annulée.")} className="text-xs font-bold text-muted hover:text-err">Annuler</button>}>
                <div className="mb-3 h-2 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-ok" style={{ width: `${li.length ? (done / li.length) * 100 : 0}%` }} /></div>
                <ul className="mb-3 space-y-1.5 text-sm">
                  {li.map((i) => (
                    <li key={i.id} className="flex items-center gap-2">
                      {i.status === "bought" ? <CheckCircle2 className="size-4 text-ok" /> : i.status === "missing" ? <XCircle className="size-4 text-err" /> : <span className="size-4 rounded-full border-2 border-line" />}
                      <span className={clsx("flex-1", i.status !== "todo" && "text-muted line-through")}>{i.label}</span>
                      {i.urgent && <Badge tone="warn">urgent</Badge>}
                      <span className="text-xs font-semibold text-muted">{qtyLabel(i.qty, i.unit)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mb-2 text-xs font-bold text-muted">Oubli ? Ajout urgent : l&apos;acheteur le voit tout de suite sur son téléphone.</p>
                {addForm(l.id)}
              </Card>
            );
          })}

          <Card title="Historique">
            <div className="space-y-2">
              {history.length === 0 && <Empty>Aucune course terminée</Empty>}
              {history.map((l) => (
                <div key={l.id} className="flex items-center gap-3 rounded-xl bg-canvas px-3 py-2.5 text-sm">
                  <span className="font-extrabold">{listCode(l.num)}</span>
                  <span className="flex-1 truncate text-muted">{l.assignee?.full_name ?? "—"} · {l.done_at ? dateTime(l.done_at) : ""}</span>
                  {l.status === "cancelled" ? <Badge>annulée</Badge> : <span className="font-bold">{l.spent_total != null ? fcfa(l.spent_total) : "—"}</span>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
