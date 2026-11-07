"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, Check, X, ShoppingCart, Zap, PartyPopper, Store, Sparkles, Package } from "lucide-react";
import { rpc, supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { fcfa } from "@/lib/format";
import { LIST_COLUMNS, byAisle, fetchItems, listCode, organize, qtyLabel, type ShoppingItem, type ShoppingList } from "@/lib/shopping";

// Écran de l'employé au supermarché : une seule liste, on coche, on note le prix, on termine.
export default function ShopperPage() {
  const toast = useToast();
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const [list, setList] = useState<ShoppingList | null | undefined>(undefined);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ bought: number; missing: number; spent: number | null } | null>(null);
  const [sorting, setSorting] = useState(false);

  const load = useCallback(async () => {
    const sb = supabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const { data: p } = await sb.from("profiles").select("id, role").eq("id", user.id).single();
    setMe(p);
    const { data } = await sb.from("shopping_lists").select(LIST_COLUMNS).eq("assigned_to", user.id)
      .in("status", ["assigned", "shopping"]).order("assigned_at").limit(1).maybeSingle();
    const l = data as unknown as ShoppingList | null;
    setList(l);
    setItems(l ? await fetchItems([l.id]) : []);
  }, []);

  useEffect(() => {
    load();
    const sb = supabase();
    let t: ReturnType<typeof setTimeout> | undefined;
    const ch = sb.channel("shopper")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shopping_items" }, (p) => {
        const row = p.new as ShoppingItem;
        if (row.urgent) { toast("ok", `Ajout urgent : ${row.label}`); navigator.vibrate?.([80, 60, 80]); }
        clearTimeout(t); t = setTimeout(load, 300);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shopping_lists" }, () => { clearTimeout(t); t = setTimeout(load, 300); })
      .subscribe();
    return () => { clearTimeout(t); sb.removeChannel(ch); };
  }, [load, toast]);

  async function check(i: ShoppingItem, status: ShoppingItem["status"], bought_qty?: number | null, paid?: number | null) {
    setItems((l) => l.map((x) => (x.id === i.id ? { ...x, status, bought_qty: bought_qty ?? x.bought_qty, paid: paid ?? x.paid } : x)));
    const r = await rpc("shopping_check", { p_item_id: i.id, p_status: status, p_bought_qty: bought_qty ?? null, p_paid: paid ?? null });
    if (!r.ok) { toast("err", r.message); load(); }
  }

  async function sortAisles() {
    if (!list) return;
    setSorting(true);
    const r = await organize(list.id);
    setSorting(false);
    if (!r.ok) return toast("err", r.message);
    toast("ok", "Liste rangée par rayon.");
    load();
  }

  async function finish() {
    if (!list) return;
    setBusy(true);
    const r = await rpc<{ bought: number; missing: number; spent: number | null }>("shopping_complete", { p_list_id: list.id });
    setBusy(false);
    if (!r.ok) return toast("err", r.message);
    setDone(r);
  }

  const todo = items.filter((i) => i.status === "todo");
  const spent = items.reduce((s, i) => s + (i.status === "bought" ? i.paid ?? 0 : 0), 0);
  const est = items.reduce((s, i) => s + i.est_cost, 0);
  const back = me?.role === "agent" ? "/scan" : "/admin/courses";

  if (done) return (
    <main className="grid min-h-dvh place-items-center bg-lime p-6 text-center">
      <div>
        <PartyPopper className="mx-auto size-14" />
        <h1 className="mt-4 text-3xl font-extrabold">Courses terminées</h1>
        <p className="mt-2 font-semibold">{done.bought} acheté{done.bought > 1 ? "s" : ""}{done.missing ? ` · ${done.missing} introuvable${done.missing > 1 ? "s" : ""} (reporté${done.missing > 1 ? "s" : ""})` : ""}</p>
        {done.spent != null && <p className="mt-1 text-2xl font-extrabold">{fcfa(done.spent)}</p>}
        <p className="mt-3 text-sm">Le stock de la cuisine est mis à jour. Merci !</p>
        <Link href={back} className="mt-6 inline-flex h-12 items-center rounded-full bg-ink px-6 font-bold text-white">Retour</Link>
      </div>
    </main>
  );

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-canvas pb-32">
      <header className="sticky top-0 z-10 bg-ink px-4 pb-4 pt-[max(0.8rem,env(safe-area-inset-top))] text-white">
        <div className="flex items-center gap-3">
          <Link href={back} aria-label="Retour" className="grid size-10 place-items-center rounded-full bg-white/10"><ArrowLeft className="size-4" /></Link>
          <div className="flex-1">
            <p className="text-xs font-bold uppercase tracking-wider text-lime">Fiche de courses</p>
            <p className="text-lg font-extrabold">{list ? listCode(list.num) : "Courses"}</p>
          </div>
          {list && <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-bold">{items.length - todo.length}/{items.length}</span>}
        </div>
        {list && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-lime transition-all" style={{ width: `${items.length ? ((items.length - todo.length) / items.length) * 100 : 0}%` }} />
          </div>
        )}
      </header>

      {list === undefined && <div className="m-4 h-60 animate-pulse rounded-[22px] bg-card" />}
      {list === null && (
        <div className="p-8 text-center">
          <ShoppingCart className="mx-auto size-12 text-off" />
          <p className="mt-3 font-bold">Aucune course à faire</p>
          <p className="text-sm text-muted">La cuisine vous enverra une fiche quand il faudra acheter quelque chose.</p>
        </div>
      )}

      {list && (
        <div className="space-y-3 p-4">
          {list.note && <p className="flex items-start gap-2 rounded-2xl bg-card p-3 text-sm font-semibold"><Store className="mt-0.5 size-4 shrink-0" />{list.note}</p>}
          <div className="flex items-center gap-2 px-1">
            <p className="flex-1 text-xs font-semibold text-muted">Budget estimé {fcfa(est)} · touchez un article pour le cocher</p>
            {(!list.organized_at || items.some((i) => !i.aisle)) && (
              <button onClick={sortAisles} disabled={sorting} className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-bold text-lime disabled:opacity-60">
                <Sparkles className={clsx("size-3.5", sorting && "animate-pulse")} />{sorting ? "Rangement…" : "Ranger par rayon"}
              </button>
            )}
          </div>
          {(list.organized_at ? byAisle(items) : [["", items] as [string, ShoppingItem[]]]).map(([aisle, group]) => (
            <section key={aisle || "all"} className="space-y-2">
              {aisle && (
                <h2 className="flex items-center gap-2 px-1 pt-2 text-xs font-extrabold uppercase tracking-wider text-muted">
                  {aisle}<span className="h-px flex-1 bg-line" />
                  <span>{group.filter((i) => i.status !== "todo").length}/{group.length}</span>
                </h2>
              )}
          {group.map((i) => {
            const expanded = open === i.id;
            return (
              <div key={i.id} className={clsx("overflow-hidden rounded-2xl border bg-card transition",
                i.status === "bought" ? "border-ok/40" : i.status === "missing" ? "border-err/40" : i.urgent ? "border-warn ring-2 ring-warn/30" : "border-line")}>
                <button onClick={() => (i.status === "todo" ? check(i, "bought") : setOpen(expanded ? null : i.id))} className="flex w-full items-center gap-3 p-3.5 text-left">
                  <span className={clsx("grid size-9 shrink-0 place-items-center rounded-full border-2",
                    i.status === "bought" ? "border-ok bg-ok text-white" : i.status === "missing" ? "border-err bg-err text-white" : "border-line")}>
                    {i.status === "bought" ? <Check className="size-5" /> : i.status === "missing" ? <X className="size-5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={clsx("block text-[15px] font-bold", i.status !== "todo" && "text-muted line-through")}>{i.label}</span>
                    {i.pack_hint && i.status === "todo" && <span className="mt-0.5 flex items-center gap-1 text-[13px] font-semibold text-ink-2"><Package className="size-3.5 shrink-0 text-muted" />{i.pack_hint}</span>}
                    {i.urgent && <span className="flex items-center gap-1 text-xs font-bold text-[#b45309]"><Zap className="size-3" />Ajout urgent</span>}
                  </span>
                  <span className="text-right text-[15px] font-extrabold">{qtyLabel(i.bought_qty ?? i.qty, i.unit)}</span>
                </button>
                {i.status !== "todo" || expanded ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas/60 px-3.5 py-2.5">
                    {i.status === "bought" && (
                      <>
                        <label className="flex items-center gap-1 text-xs font-semibold text-muted">Qté
                          <input type="number" inputMode="decimal" defaultValue={i.bought_qty ?? i.qty} onBlur={(e) => check(i, "bought", +e.target.value, i.paid)}
                            className="h-8 w-16 rounded-lg border border-line px-1.5 text-right font-bold text-ink" /></label>
                        <label className="flex items-center gap-1 text-xs font-semibold text-muted">Prix payé
                          <input type="number" inputMode="numeric" defaultValue={i.paid ?? ""} placeholder="FCFA" onBlur={(e) => check(i, "bought", i.bought_qty, e.target.value ? +e.target.value : null)}
                            className="h-8 w-24 rounded-lg border border-line px-1.5 text-right font-bold text-ink" /></label>
                      </>
                    )}
                    <span className="ml-auto flex gap-1.5">
                      {i.status !== "missing" && <button onClick={() => check(i, "missing")} className="rounded-full bg-err-soft px-3 py-1 text-xs font-bold text-err">Introuvable</button>}
                      {i.status !== "todo" && <button onClick={() => check(i, "todo")} className="rounded-full bg-card px-3 py-1 text-xs font-bold text-muted">Annuler</button>}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
            </section>
          ))}
        </div>
      )}

      {list && (
        <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md bg-gradient-to-t from-canvas via-canvas to-transparent p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button block size="lg" variant="dark" loading={busy} disabled={todo.length > 0} onClick={finish}>
            {todo.length > 0 ? `Encore ${todo.length} article${todo.length > 1 ? "s" : ""}` : <>Terminer les courses <span className="text-lime">·</span> {fcfa(spent)}</>}
          </Button>
        </div>
      )}
    </main>
  );
}
