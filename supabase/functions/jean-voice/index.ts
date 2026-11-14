// POST /functions/v1/jean-voice?token=…   (fonctions personnalisées de l'agent vocal Retell « Jean »)
// Corps envoyé par Retell : { name, args, call: { call_id, from_number?, … } }
// Sécurité : jeton secret dans l'URL (JEAN_VOICE_TOKEN) ; client identifié par son numéro WhatsApp lié, ou par son code
// client + un code à 4 chiffres envoyé dans l'appli / sur WhatsApp ; la commande se confirme dans l'appli (jamais de PIN à l'oral).
import { adminClient } from "../_shared/http.ts";

const APP = "https://dabalix.netlify.app";
const db = adminClient();
const todayISO = () => new Date().toISOString().slice(0, 10); // Abidjan = UTC+0
const fcfa = (n: number) => `${n} francs`;
const ok = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

async function hash(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`dabali-voice:${s}`));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Client lié à cet appel (numéro WhatsApp lié, ou code vérifié pendant l'appel) */
async function caller(callId: string, fromNumber?: string): Promise<{ id: string; name: string } | null> {
  const { data: vc } = await db.from("voice_calls").select("user_id").eq("call_id", callId).maybeSingle();
  let uid = vc?.user_id as string | undefined;
  if (!uid && fromNumber) {
    const { data: l } = await db.from("whatsapp_links").select("user_id").eq("phone", fromNumber).maybeSingle();
    if (l) { uid = l.user_id; await db.from("voice_calls").upsert({ call_id: callId, user_id: uid }); }
  }
  if (!uid) return null;
  const { data: p } = await db.from("profiles").select("full_name, is_blocked").eq("id", uid).single();
  if (!p || p.is_blocked) return null;
  return { id: uid, name: p.full_name };
}

async function run(name: string, args: any, call: any): Promise<unknown> {
  const callId = String(call?.call_id ?? "");
  if (!callId) return { erreur: "Appel inconnu." };
  const me = await caller(callId, call?.from_number);
  const needMe = () => ({ erreur: "Client pas encore identifié : demande son code client (DB suivi de 4 chiffres) puis utilise envoyer_code." });

  switch (name) {
    case "qui_appelle":
      return me ? { identifie: true, prenom: me.name.split(" ")[0], nom: me.name } : { identifie: false };

    case "envoyer_code": {
      const raw = String(args?.code_client ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
      const digits = raw.replace(/^DB/, "");
      if (!/^\d{4}$/.test(digits)) return { erreur: "Code client invalide : il faut DB suivi de 4 chiffres." };
      const { data: vc } = await db.from("voice_calls").select("codes_sent").eq("call_id", callId).maybeSingle();
      if ((vc?.codes_sent ?? 0) >= 3) return { erreur: "Trop de codes envoyés pendant cet appel." };
      const { data: p } = await db.from("profiles").select("id, full_name, is_blocked").eq("short_code", `DB-${digits}`).maybeSingle();
      // Même réponse si le code n'existe pas : on ne révèle pas quels comptes existent
      const code = String(Math.floor(1000 + Math.random() * 9000));
      if (p && !p.is_blocked) {
        await db.from("voice_calls").upsert({ call_id: callId, pending_user: p.id, code_hash: await hash(code),
          code_expires: new Date(Date.now() + 5 * 60e3).toISOString(), attempts: 0, codes_sent: (vc?.codes_sent ?? 0) + 1 });
        await db.from("notifications").insert({ user_id: p.id, type: "voice_code", title: `Code d'appel Jean : ${code}`,
          body: "Dis ce code à Jean au téléphone pour qu'il te reconnaisse. Tu n'es pas au téléphone avec Jean ? Ignore ce message.", data: {} });
      } else {
        await db.from("voice_calls").upsert({ call_id: callId, codes_sent: (vc?.codes_sent ?? 0) + 1 });
      }
      return { envoye: true, message: "Si ce code client existe, un code à 4 chiffres vient d'arriver dans l'appli Dabali et sur WhatsApp." };
    }

    case "verifier_code": {
      const { data: vc } = await db.from("voice_calls").select("*").eq("call_id", callId).maybeSingle();
      if (!vc?.pending_user || !vc.code_hash) return { erreur: "Aucun code envoyé. Utilise d'abord envoyer_code." };
      if (vc.attempts >= 3) return { erreur: "Trop d'essais : impossible d'identifier le client pendant cet appel." };
      if (new Date(vc.code_expires).getTime() < Date.now()) return { erreur: "Code expiré : renvoie un code." };
      const code = String(args?.code ?? "").replace(/\D/g, "");
      if ((await hash(code)) !== vc.code_hash) {
        await db.from("voice_calls").update({ attempts: vc.attempts + 1 }).eq("call_id", callId);
        return { erreur: `Code incorrect. Essais restants : ${2 - vc.attempts}.` };
      }
      await db.from("voice_calls").update({ user_id: vc.pending_user, pending_user: null, code_hash: null }).eq("call_id", callId);
      const { data: p } = await db.from("profiles").select("full_name").eq("id", vc.pending_user).single();
      return { identifie: true, prenom: String(p?.full_name ?? "").split(" ")[0] };
    }

    case "voir_menu": {
      const from = args?.date || todayISO();
      const to = args?.date || new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
      let q = db.from("menu_items").select("id, service_date, service, price, is_sold_out, is_full, dish:dishes(name), menu:menus!inner(status)")
        .eq("menu.status", "published").gte("service_date", from).lte("service_date", to).order("service_date");
      if (["breakfast", "lunch", "snack", "dinner"].includes(args?.repas)) q = q.eq("service", args.repas);
      const [{ data }, { data: s }, { data: o }] = await Promise.all([q,
        db.from("settings").select("value").eq("key", "services").single(),
        db.from("settings").select("value").eq("key", "orders").single()]);
      return { aujourdhui: todayISO(), heure_actuelle: new Date().toISOString().slice(11, 16), horaires_repas: s?.value,
        horaires_commandes_du_jour: (o?.value as any)?.windows ?? {},
        plats: (data ?? []).map((r: any) => ({ menu_item_id: r.id, date: r.service_date, repas: r.service, plat: r.dish?.name, prix: fcfa(r.price), disponible: !(r.is_sold_out || r.is_full) })) };
    }

    case "voir_creneaux": {
      const { data } = await db.rpc("order_slots", { p_date: args?.date, p_service: args?.repas });
      return { creneaux_libres: ((data ?? []) as { at: string; left: number }[]).filter((x) => x.left > 0).map((x) => x.at.slice(11, 16)) };
    }

    case "voir_solde": {
      if (!me) return needMe();
      const { data: w } = await db.from("wallets").select("balance").eq("user_id", me.id).single();
      return { solde: fcfa(w?.balance ?? 0) };
    }

    case "mes_commandes": {
      if (!me) return needMe();
      const { data } = await db.from("tickets").select("order_no, pickup_at, prep_status, item:menu_items(dish:dishes(name))")
        .eq("user_id", me.id).eq("status", "valid").not("pickup_at", "is", null).order("pickup_at");
      return { commandes: (data ?? []).map((t: any) => ({ numero: t.order_no, plat: t.item?.dish?.name, retrait: t.pickup_at,
        etat: { received: "reçue", preparing: "en préparation", ready: "prête" }[t.prep_status as string] ?? t.prep_status })) };
    }

    case "preparer_commande": {
      if (!me) return needMe();
      const { data: mi } = await db.from("menu_items").select("id, service_date, service, price, is_sold_out, is_full, dish:dishes(name), menu:menus!inner(status)")
        .eq("id", args?.menu_item_id).eq("menu.status", "published").maybeSingle();
      if (!mi) return { erreur: "Ce plat n'est pas au menu." };
      if (mi.is_sold_out || mi.is_full) return { erreur: "Ce plat est épuisé." };
      const hm = String(args?.heure_retrait ?? "");
      if (!/^\d{2}:\d{2}$/.test(hm)) return { erreur: "Heure invalide, format HH:MM." };
      const pickup = `${mi.service_date}T${hm}:00Z`;
      const { data: slots } = await db.rpc("order_slots", { p_date: mi.service_date, p_service: mi.service });
      if (!((slots ?? []) as { at: string; left: number }[]).some((x) => new Date(x.at).getTime() === new Date(pickup).getTime() && x.left > 0)) {
        return { erreur: "Ce créneau n'est pas libre. Utilise voir_creneaux." };
      }
      const { count } = await db.from("order_requests").select("id", { count: "exact", head: true })
        .eq("user_id", me.id).eq("status", "pending").gt("expires_at", new Date().toISOString());
      if ((count ?? 0) >= 3) return { erreur: "Trop de demandes en attente de confirmation." };
      const { data: r, error } = await db.from("order_requests").insert({ user_id: me.id, menu_item_id: mi.id, pickup_at: pickup, source: "phone" }).select("token").single();
      if (error || !r) return { erreur: "Impossible de préparer la commande." };
      const dish = (mi as any).dish?.name;
      await db.from("notifications").insert({ user_id: me.id, type: "order_link", title: "Confirme ta commande avec Jean 📞",
        body: `${dish} · retrait à ${hm.replace(":", "h")} · ${mi.price} F. Touche pour confirmer (Face ID ou code PIN). Valable 15 minutes.`,
        data: { href: `/app/confirmer/${r.token}` } });
      return { lien_envoye: true, plat: dish, retrait: hm, prix: fcfa(mi.price),
        consigne: "Le lien de confirmation est arrivé dans l'appli Dabali et sur WhatsApp. La commande n'est passée qu'une fois confirmée par le client (Face ID ou code PIN)." };
    }
  }
  return { erreur: "Fonction inconnue." };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const expected = Deno.env.get("JEAN_VOICE_TOKEN");
  let allowed = !!expected && url.searchParams.get("token") === expected;
  const internal = req.headers.get("x-jean-secret"); // tests depuis la base
  if (!allowed && internal) { const { data } = await db.rpc("_jean_secret"); allowed = !!data && internal === data; }
  if (!allowed) return new Response("unauthorized", { status: 401 });
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const body = await req.json().catch(() => null);
  if (!body) return ok({ erreur: "Requête invalide." });
  const name = String(body.name ?? url.searchParams.get("fn") ?? "");
  try {
    return ok(await run(name, body.args ?? {}, body.call ?? {}));
  } catch (e) {
    console.error("jean-voice", name, e);
    return ok({ erreur: "Service momentanément indisponible." });
  }
});
