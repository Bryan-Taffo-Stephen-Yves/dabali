"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Plus, Upload, Trash2, Search } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { PageTitle, Badge, input } from "@/components/admin/ui";
import { DishImage } from "@/components/app/dish-image";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { fcfa } from "@/lib/format";
import type { Dish } from "@/lib/types";

type Cat = { id: number; name: string };
type Ing = { id: string; name: string; unit: string };
type Line = { ingredient_id: string; qty_per_portion: number };
type D = Dish & { is_active: boolean };
const EMPTY: Partial<D> = { photo_credit: null, photo_source: null, name: "", description: "", composition: "", kcal: null, weight_g: null, allergens: [], base_price: 2000, is_active: true, category_id: null, photo_url: null };

export default function DishesPage() {
  const toast = useToast();
  const [dishes, setDishes] = useState<D[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [ings, setIngs] = useState<Ing[]>([]);
  const [edit, setEdit] = useState<Partial<D> | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sb = supabase();
    const [d, c, i] = await Promise.all([
      sb.from("dishes").select("*").order("name"),
      sb.from("categories").select("id, name").order("sort"),
      sb.from("ingredients").select("id, name, unit").order("name"),
    ]);
    setDishes((d.data ?? []) as D[]); setCats(c.data ?? []); setIngs(i.data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function open(d: Partial<D>) {
    setEdit({ ...d });
    if (d.id) {
      const { data } = await supabase().from("recipe_lines").select("ingredient_id, qty_per_portion").eq("dish_id", d.id);
      setLines(data ?? []);
    } else setLines([]);
  }

  async function upload(file: File) {
    if (!edit) return;
    setBusy(true);
    const path = `${crypto.randomUUID()}.${file.name.split(".").pop() || "jpg"}`;
    const { error } = await supabase().storage.from("dishes").upload(path, file, { contentType: file.type, upsert: false });
    setBusy(false);
    if (error) return toast("err", "Envoi de la photo impossible (5 Mo max, JPG/PNG/WebP).");
    const { data } = supabase().storage.from("dishes").getPublicUrl(path);
    setEdit({ ...edit, photo_url: data.publicUrl });
  }

  async function save() {
    if (!edit?.name || !edit.base_price) return toast("err", "Nom et prix obligatoires.");
    setBusy(true);
    const sb = supabase();
    const payload = {
      name: edit.name.trim(), category_id: edit.category_id, description: edit.description || null, composition: edit.composition || null,
      kcal: edit.kcal || null, weight_g: edit.weight_g || null, allergens: edit.allergens ?? [], photo_url: edit.photo_url || null,
      photo_credit: edit.photo_credit || null, photo_source: edit.photo_source || null,
      base_price: edit.base_price, is_active: edit.is_active ?? true, updated_at: new Date().toISOString(),
    };
    const res = edit.id ? await sb.from("dishes").update(payload).eq("id", edit.id).select("id").single()
      : await sb.from("dishes").insert(payload).select("id").single();
    if (res.error || !res.data) { setBusy(false); return toast("err", "Enregistrement refusé."); }
    const id = res.data.id;
    await sb.from("recipe_lines").delete().eq("dish_id", id);
    const valid = lines.filter((l) => l.ingredient_id && l.qty_per_portion > 0);
    if (valid.length) await sb.from("recipe_lines").insert(valid.map((l) => ({ ...l, dish_id: id })));
    setBusy(false);
    toast("ok", "Plat enregistré.");
    setEdit(null); load();
  }

  const list = dishes.filter((d) => d.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageTitle title="Plats" subtitle="Catalogue, photos, composition et recettes">
        <label className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher" className={clsx(input, "pl-9")} /></label>
        <Button size="sm" variant="dark" onClick={() => open(EMPTY)}><Plus className="size-4" />Nouveau plat</Button>
      </PageTitle>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((d) => (
          <button key={d.id} onClick={() => open(d)} className="overflow-hidden rounded-[22px] border border-line bg-card text-left transition hover:shadow-[var(--shadow-card)]">
            <DishImage name={d.name} src={d.photo_url} rounded="rounded-none" className={clsx("h-36 w-full", !d.is_active && "grayscale")} />
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-extrabold">{d.name}</p>
                <span className="shrink-0 font-extrabold">{fcfa(d.base_price)}</span>
              </div>
              <p className="mt-1 line-clamp-1 text-sm text-muted">{d.composition}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge>{cats.find((c) => c.id === d.category_id)?.name ?? "Sans catégorie"}</Badge>
                {d.kcal && <Badge>{d.kcal} kcal</Badge>}
                {!d.is_active && <Badge tone="err">Inactif</Badge>}
                {!d.photo_url && <Badge tone="warn">Sans photo</Badge>}
              </div>
            </div>
          </button>
        ))}
      </div>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier le plat" : "Nouveau plat"}>
        {edit && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <DishImage name={edit.name || "Plat"} src={edit.photo_url} className="size-24" />
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-4 py-3 text-sm font-bold">
                <Upload className="size-4" />{edit.photo_url ? "Changer la photo" : "Ajouter une photo"}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
            </div>
            <input value={edit.photo_credit ?? ""} onChange={(e) => setEdit({ ...edit, photo_credit: e.target.value })} placeholder="Crédit photo (auteur · licence) — obligatoire pour une photo CC BY-SA" className={clsx(input, "w-full text-xs")} />
            <input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Nom du plat" className={clsx(input, "w-full")} />
            <div className="grid grid-cols-2 gap-2">
              <select value={edit.category_id ?? ""} onChange={(e) => setEdit({ ...edit, category_id: e.target.value ? +e.target.value : null })} className={input}>
                <option value="">Catégorie…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input type="number" value={edit.base_price ?? ""} onChange={(e) => setEdit({ ...edit, base_price: +e.target.value })} placeholder="Prix (FCFA)" className={input} />
              <input type="number" value={edit.kcal ?? ""} onChange={(e) => setEdit({ ...edit, kcal: +e.target.value || null })} placeholder="kcal" className={input} />
              <input type="number" value={edit.weight_g ?? ""} onChange={(e) => setEdit({ ...edit, weight_g: +e.target.value || null })} placeholder="Poids (g)" className={input} />
            </div>
            <textarea value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="Description" rows={2} className={clsx(input, "h-auto w-full py-2")} />
            <input value={edit.composition ?? ""} onChange={(e) => setEdit({ ...edit, composition: e.target.value })} placeholder="Composition (attiéké, poisson…)" className={clsx(input, "w-full")} />
            <input value={(edit.allergens ?? []).join(", ")} onChange={(e) => setEdit({ ...edit, allergens: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="Allergènes (séparés par des virgules)" className={clsx(input, "w-full")} />

            <div>
              <p className="mb-2 text-sm font-extrabold">Recette (par portion)</p>
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <select value={l.ingredient_id} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, ingredient_id: e.target.value } : x)))} className={clsx(input, "flex-1")}>
                      <option value="">Ingrédient…</option>{ings.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.unit})</option>)}
                    </select>
                    <input type="number" step="0.01" value={l.qty_per_portion || ""} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty_per_portion: +e.target.value } : x)))} className={clsx(input, "w-24")} placeholder="Qté" />
                    <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-err" aria-label="Retirer"><Trash2 className="size-4" /></button>
                  </div>
                ))}
                <button onClick={() => setLines([...lines, { ingredient_id: "", qty_per_portion: 0 }])} className="text-sm font-bold text-muted hover:text-ink">+ Ingrédient</button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-bold">
              <input type="checkbox" checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} className="size-4 accent-[#16181D]" /> Plat actif
            </label>
            <Button block size="lg" loading={busy} onClick={save}>Enregistrer</Button>
          </div>
        )}
      </Sheet>
    </>
  );
}
