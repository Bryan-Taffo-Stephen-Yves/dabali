// POST /functions/v1/send-push  { notification_id }  — appelée par la base (trigger + pg_net), pas par le navigateur.
// Envoie la notification aux téléphones abonnés de l'utilisateur (Web Push, clés VAPID dans Supabase Vault).
// Les abonnements expirés (404 / 410) sont supprimés.
import webpush from "npm:web-push@3.6.7";
import { adminClient, fail, json } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("METHOD", "POST uniquement", 405);
  const db = adminClient();
  const { data: cfg } = await db.rpc("_push_config");
  if (!cfg?.private || !cfg?.public || !cfg?.secret) return fail("NOT_CONFIGURED", "Push non configuré.", 500);
  if (req.headers.get("x-push-secret") !== cfg.secret) return fail("FORBIDDEN", "Appel non autorisé.", 403);

  const { notification_id } = await req.json().catch(() => ({}));
  const { data: n } = await db.from("notifications").select("id, user_id, type, title, body, data").eq("id", notification_id).maybeSingle();
  if (!n) return fail("NOT_FOUND", "Notification introuvable.", 404);
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", n.user_id);
  if (!subs?.length) return json({ ok: true, sent: 0 });

  webpush.setVapidDetails("mailto:contact@dabali.app", cfg.public, cfg.private);
  const payload = JSON.stringify({ title: n.title, body: n.body ?? "", href: n.data?.href ?? "/app/notifications", tag: n.type });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: "high" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
    }
  }));
  return json({ ok: true, sent });
});
