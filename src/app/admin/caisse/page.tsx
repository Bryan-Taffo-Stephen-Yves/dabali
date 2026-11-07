"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Search, Printer, Lock, Unlock, Banknote, CheckCircle2 } from "lucide-react";
import { rpc, supabase } from "@/lib/supabase/client";
import { Card, PageTitle, Badge, Empty, input } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { dateTime, fcfa, signedFcfa } from "@/lib/format";

type U = { id: string; full_name: string; phone: string | null; short_code: string; role: string; points: number; is_blocked: boolean; balance: number; email: string };
type Tx = { id: string; type: string; amount: number; balance_after: number; note: string | null; created_at: string };
type Receipt = { client: string; amount: number; balance_after: number; cashier: string; at: string; transaction_id: string };

const TX_LABEL: Record<string, string> = {
  recharge: "Recharge Mobile Money", recharge_cash: "Recharge espèces", purchase: "Achat", transfer_in: "Transfert reçu",
  transfer_out: "Transfert envoyé", refund: "Remboursement", bonus: "Bonus",
};

export default function CashierPage() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<U[] | null>(null);
  const [sel, setSel] = useState<U | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const search = useCallback(async (query: string) => {
    const { data } = await supabase().rpc("admin_find_users", { p_query: query });
    setUsers((data ?? []) as U[]);
  }, []);
  useEffect(() => { const t = setTimeout(() => search(q), 250); return () => clearTimeout(t); }, [q, search]);

  const open = useCallback(async (u: U) => {
    setSel(u); setReceipt(null); setAmount("");
    const { data } = await supabase().from("transactions").select("id, type, amount, balance_after, note, created_at")
      .eq("user_id", u.id).order("created_at", { ascending: false }).limit(12);
    setTxs(data ?? []);
  }, []);

  async function credit() {
    if (!sel) return;
    const v = parseInt(amount, 10);
    setBusy(true);
    const r = await rpc<{ balance: number; transaction_id: string; receipt: Omit<Receipt, "transaction_id"> }>("credit_wallet", { p_user_id: sel.id, p_amount: v, p_note: "Espèces (caisse)" });
    setBusy(false);
    if (!r.ok) return toast("err", r.message);
    setReceipt({ ...r.receipt, transaction_id: r.transaction_id });
    toast("ok", `${fcfa(v)} crédités à ${sel.full_name}.`);
    const nu = { ...sel, balance: r.balance };
    open(nu); setReceipt({ ...r.receipt, transaction_id: r.transaction_id }); search(q);
  }

  async function toggleBlock() {
    if (!sel) return;
    const r = await rpc("set_user_blocked", { p_user_id: sel.id, p_blocked: !sel.is_blocked });
    if (!r.ok) return toast("err", r.message);
    toast("ok", sel.is_blocked ? "Compte débloqué." : "Compte bloqué.");
    setSel({ ...sel, is_blocked: !sel.is_blocked }); search(q);
  }

  return (
    <>
      <PageTitle title="Caisse" subtitle="Créditez un compte contre espèces, consultez les soldes" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <label className="relative block">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, téléphone, identifiant DB-…, e-mail"
              className={clsx(input, "h-12 w-full pl-9 text-[15px]")} />
          </label>
          <div className="mt-3 max-h-[60vh] divide-y divide-line overflow-y-auto">
            {users?.length === 0 && <Empty>Aucun résultat</Empty>}
            {users?.map((u) => (
              <button key={u.id} onClick={() => open(u)}
                className={clsx("flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition", sel?.id === u.id ? "bg-lime-soft" : "hover:bg-canvas")}>
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-canvas text-sm font-extrabold">{u.full_name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{u.full_name} {u.is_blocked && <Badge tone="err">Bloqué</Badge>}</span>
                  <span className="block truncate text-xs text-muted">{u.short_code} · {u.phone ?? u.email}</span>
                </span>
                <span className="text-sm font-extrabold">{fcfa(u.balance)}</span>
              </button>
            ))}
          </div>
        </Card>

        {!sel ? (
          <Card><div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
            <Banknote className="size-10 text-off" /><p className="mt-3 font-bold">Sélectionnez un client</p>
            <p className="text-sm text-muted">Demandez-lui son identifiant (ex. DB-2026) ou son numéro.</p>
          </div></Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xl font-extrabold">{sel.full_name}</p>
                  <p className="text-sm text-muted">{sel.short_code} · {sel.phone} · {sel.email}</p>
                </div>
                <Button size="sm" variant={sel.is_blocked ? "outline" : "danger"} onClick={toggleBlock}>
                  {sel.is_blocked ? <><Unlock className="size-4" />Débloquer</> : <><Lock className="size-4" />Bloquer</>}
                </Button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-ink p-4 text-white"><p className="text-xs font-bold text-white/60">Solde</p><p className="text-2xl font-extrabold">{fcfa(sel.balance)}</p></div>
                <div className="rounded-2xl bg-canvas p-4"><p className="text-xs font-bold text-muted">Points fidélité</p><p className="text-2xl font-extrabold">{sel.points}</p></div>
              </div>

              <div className="mt-5">
                <p className="mb-2 text-sm font-extrabold">Créditer en espèces</p>
                <div className="flex flex-wrap gap-2">
                  {[1000, 2000, 5000, 10000, 20000].map((a) => (
                    <button key={a} onClick={() => setAmount(String(a))}
                      className={clsx("h-10 rounded-xl px-3.5 text-sm font-bold", amount === String(a) ? "bg-ink text-lime" : "bg-canvas")}>{fcfa(a, false)}</button>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 7))} placeholder="Montant (FCFA)"
                    className={clsx(input, "h-12 flex-1 text-lg font-extrabold")} />
                  <Button size="lg" loading={busy} disabled={!amount || +amount < 100 || sel.is_blocked} onClick={credit}>Créditer</Button>
                </div>
              </div>
            </Card>

            {receipt && (
              <Card className="border-ok/40">
                <div id="receipt" className="font-mono text-sm">
                  <p className="flex items-center gap-2 font-sans font-extrabold text-[#15803d]"><CheckCircle2 className="size-5" />Reçu de caisse</p>
                  <dl className="mt-3 grid grid-cols-2 gap-y-1">
                    <dt className="text-muted">Client</dt><dd className="text-right font-bold">{receipt.client}</dd>
                    <dt className="text-muted">Montant</dt><dd className="text-right font-bold">{fcfa(receipt.amount)}</dd>
                    <dt className="text-muted">Nouveau solde</dt><dd className="text-right font-bold">{fcfa(receipt.balance_after)}</dd>
                    <dt className="text-muted">Caissier</dt><dd className="text-right">{receipt.cashier}</dd>
                    <dt className="text-muted">Date</dt><dd className="text-right">{dateTime(receipt.at)}</dd>
                    <dt className="text-muted">Réf.</dt><dd className="text-right">{receipt.transaction_id.slice(0, 8).toUpperCase()}</dd>
                  </dl>
                </div>
                <Button size="sm" variant="outline" className="mt-4" onClick={() => printReceipt(receipt)}><Printer className="size-4" />Imprimer</Button>
              </Card>
            )}

            <Card title="Dernières opérations">
              <div className="divide-y divide-line">
                {txs.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="flex-1"><b>{TX_LABEL[t.type]}</b>{t.note && <span className="text-muted"> · {t.note}</span>}<span className="block text-xs text-muted">{dateTime(t.created_at)}</span></span>
                    <span className={clsx("font-extrabold", t.amount > 0 && "text-[#15803d]")}>{signedFcfa(t.amount)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

function printReceipt(r: Receipt) {
  const w = window.open("", "_blank", "width=380,height=560");
  if (!w) return;
  w.document.write(`<html><head><title>Reçu Dabali</title><style>body{font-family:ui-monospace,monospace;padding:16px;width:300px}h1{font-size:18px;margin:0 0 4px}hr{border:0;border-top:1px dashed #999;margin:10px 0}p{display:flex;justify-content:space-between;margin:4px 0;font-size:13px}</style></head><body>
  <h1>DABALI · Cantine</h1><div style="font-size:12px">Reçu de recharge (espèces)</div><hr/>
  <p><span>Client</span><b>${r.client}</b></p><p><span>Montant</span><b>${fcfa(r.amount)}</b></p><p><span>Nouveau solde</span><b>${fcfa(r.balance_after)}</b></p>
  <hr/><p><span>Caissier</span><span>${r.cashier}</span></p><p><span>Date</span><span>${dateTime(r.at)}</span></p><p><span>Réf.</span><span>${r.transaction_id.slice(0, 8).toUpperCase()}</span></p>
  <hr/><div style="text-align:center;font-size:12px">Merci et bon appétit !</div><script>window.print()</script></body></html>`);
  w.document.close();
}
