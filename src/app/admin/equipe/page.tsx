"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { UserPlus } from "lucide-react";
import { rpc, supabase } from "@/lib/supabase/client";
import { Card, PageTitle, Badge, input } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useStaff } from "@/components/admin/admin-shell";
import { dateTime, fcfa } from "@/lib/format";

type P = { id: string; full_name: string; short_code: string; role: string; is_blocked: boolean };
type Log = { id: number; action: string; target: string | null; payload: Record<string, unknown>; created_at: string; actor: { full_name: string } | null };

const ROLES: [string, string][] = [["agent", "Agent (scan)"], ["caissier", "Caisse"], ["chef", "Chef"], ["admin", "Admin"], ["client", "Client"]];
const ACTION: Record<string, string> = {
  redeem_ticket: "a scanné un ticket", credit_wallet: "a crédité un compte", publish_menu: "a publié un menu", submit_menu: "a soumis un menu",
  set_role: "a changé un rôle", block_user: "a bloqué un compte", unblock_user: "a débloqué un compte", pin_locked: "PIN bloqué (3 erreurs)",
};

export default function TeamPage() {
  const toast = useToast();
  const me = useStaff();
  const [staff, setStaff] = useState<P[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<P[]>([]);

  const load = useCallback(async () => {
    const sb = supabase();
    const [s, l] = await Promise.all([
      sb.from("profiles").select("id, full_name, short_code, role, is_blocked").neq("role", "client").order("role"),
      sb.from("audit_log").select("id, action, target, payload, created_at, actor:profiles(full_name)").order("created_at", { ascending: false }).limit(60),
    ]);
    setStaff((s.data ?? []) as P[]); setLogs((l.data ?? []) as unknown as Log[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!adding || q.length < 2) { setFound([]); return; }
    const t = setTimeout(() => supabase().rpc("admin_find_users", { p_query: q }).then(({ data }) => setFound((data ?? []) as P[])), 250);
    return () => clearTimeout(t);
  }, [q, adding]);

  async function setRole(id: string, role: string) {
    const r = await rpc("admin_set_role", { p_user_id: id, p_role: role });
    if (!r.ok) return toast("err", r.message);
    toast("ok", "Rôle mis à jour."); setAdding(false); load();
  }
  async function toggle(p: P) {
    const r = await rpc("set_user_blocked", { p_user_id: p.id, p_blocked: !p.is_blocked });
    if (!r.ok) return toast("err", r.message);
    load();
  }

  const shown = logs.filter((l) => !filter || l.action === filter);

  return (
    <>
      <PageTitle title="Équipe" subtitle="Comptes du personnel et journal des actions">
        <Button size="sm" variant="dark" onClick={() => setAdding(true)}><UserPlus className="size-4" />Ajouter un membre</Button>
      </PageTitle>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card title="Personnel" pad>
          <div className="divide-y divide-line">
            {staff.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-3">
                <span className="grid size-10 place-items-center rounded-full bg-canvas text-sm font-extrabold">{p.full_name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{p.full_name} {p.is_blocked && <Badge tone="err">Bloqué</Badge>}</p>
                  <p className="text-xs text-muted">{p.short_code}</p>
                </div>
                <select value={p.role} disabled={p.id === me?.id} onChange={(e) => setRole(p.id, e.target.value)} className={clsx(input, "h-9")}>
                  {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {p.id !== me?.id && <button onClick={() => toggle(p)} className="text-xs font-bold text-muted hover:text-err">{p.is_blocked ? "Débloquer" : "Bloquer"}</button>}
              </div>
            ))}
          </div>
        </Card>
        <Card title="Journal" subtitle="Qui a scanné quoi, qui a crédité quoi"
          action={<select value={filter} onChange={(e) => setFilter(e.target.value)} className={clsx(input, "h-9")}>
            <option value="">Toutes les actions</option>{Object.entries(ACTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}>
          <div className="max-h-[560px] space-y-2 overflow-y-auto">
            {shown.map((l) => (
              <div key={l.id} className="flex items-start gap-3 rounded-xl bg-canvas px-3 py-2 text-sm">
                <span className="flex-1"><b>{l.actor?.full_name ?? "Système"}</b> {ACTION[l.action] ?? l.action}
                  {typeof l.payload?.amount === "number" && <> · <b>{fcfa(l.payload.amount as number)}</b></>}
                  {typeof l.payload?.role === "string" && <> → <b>{l.payload.role as string}</b></>}
                </span>
                <span className="shrink-0 text-xs text-muted">{dateTime(l.created_at)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Ajouter un membre">
        <p className="-mt-2 mb-3 text-sm text-muted">La personne crée d&apos;abord un compte dans l&apos;appli, puis vous lui attribuez un rôle.</p>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, e-mail, téléphone ou DB-…" className={clsx(input, "w-full")} />
        <div className="mt-3 divide-y divide-line">
          {found.map((u) => (
            <div key={u.id} className="flex items-center gap-2 py-2.5">
              <span className="flex-1 text-sm"><b>{u.full_name}</b> <span className="text-muted">{u.short_code} · {u.role}</span></span>
              {ROLES.slice(0, 3).map(([v, l]) => <button key={v} onClick={() => setRole(u.id, v)} className="rounded-lg bg-canvas px-2 py-1 text-xs font-bold hover:bg-lime">{l.split(" ")[0]}</button>)}
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}
