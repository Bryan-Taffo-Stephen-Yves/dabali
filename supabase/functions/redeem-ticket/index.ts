// POST /functions/v1/redeem-ticket  { token: string, service_date: "YYYY-MM-DD", service: "lunch" | "dinner" }
// Appelée par l'écran /scan (JWT d'un agent). Vérifie la signature HMAC AVANT toute requête en base,
// puis appelle la RPC redeem_ticket (exécutable seulement par service_role) qui fait l'UPDATE atomique.
import { adminClient, corsHeaders, fail, json, qrSecret, requestUser } from "../_shared/http.ts";
import { verifyTicketToken } from "../_shared/qr.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("METHOD", "POST uniquement", 405);

  const agent = await requestUser(req);
  if (!agent) return fail("AUTH_REQUIRED", "Connexion requise.", 401);

  const body = await req.json().catch(() => null);
  const { token, service_date, service } = body ?? {};
  if (typeof token !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(service_date ?? "") || !["lunch", "dinner"].includes(service)) {
    return fail("BAD_REQUEST", "Requête invalide.");
  }

  const parsed = await verifyTicketToken(token, qrSecret());
  if (!parsed) return json({ ok: false, code: "INVALID_QR", message: "QR invalide." });

  // Le rôle de l'agent est revérifié dans redeem_ticket (agent ou admin, non bloqué).
  const { data, error } = await adminClient().rpc("redeem_ticket", {
    p_ticket_id: parsed.ticketId,
    p_nonce: parsed.nonce,
    p_agent_id: agent.id,
    p_service_date: service_date,
    p_service: service,
  });
  if (error) return fail("DB_ERROR", error.message, 500);
  return json(data);
});
