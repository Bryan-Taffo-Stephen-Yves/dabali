// POST /functions/v1/ticket-token  { ticket_ids?: string[] }
// Renvoie les jetons QR signés des tickets VALIDES dont l'appelant est le bénéficiaire.
// L'appli les met en cache pour afficher les QR hors ligne (§4.11).
import { adminClient, corsHeaders, fail, json, qrSecret, requestUser } from "../_shared/http.ts";
import { signTicketToken } from "../_shared/qr.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("METHOD", "POST uniquement", 405);

  const user = await requestUser(req);
  if (!user) return fail("AUTH_REQUIRED", "Connexion requise.", 401);

  const body = await req.json().catch(() => ({}));
  const ids: string[] | undefined = Array.isArray(body?.ticket_ids) ? body.ticket_ids.slice(0, 50) : undefined;

  let q = adminClient()
    .from("tickets")
    .select("id, qr_nonce, valid_until")
    .eq("user_id", user.id) // uniquement SES tickets, même pour un membre de l'équipe
    .eq("status", "valid");
  if (ids?.length) q = q.in("id", ids);

  const { data, error } = await q;
  if (error) return fail("DB_ERROR", error.message, 500);

  const secret = qrSecret();
  const tokens = await Promise.all(
    (data ?? []).map(async (t) => ({
      ticket_id: t.id,
      valid_until: t.valid_until,
      token: await signTicketToken(t.id, t.qr_nonce, secret),
    })),
  );
  return json({ ok: true, tokens });
});
