import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const fail = (code: string, message: string, status = 400) => json({ ok: false, code, message }, status);

/** Client service_role : contourne la RLS. Ne jamais l'exposer au navigateur. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Utilisateur authentifié à partir du JWT de la requête, ou null. */
export async function requestUser(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await adminClient().auth.getUser(token);
  return error ? null : data.user;
}

/**
 * Clé de signature des QR, côté serveur uniquement.
 * QR_HMAC_SECRET si défini ; sinon dérivée de la clé service_role (injectée par Supabase dans les
 * Edge Functions, jamais exposée au navigateur). Changer l'une ou l'autre invalide les QR en cache.
 */
export function qrSecret(): string {
  const s = Deno.env.get("QR_HMAC_SECRET") ?? `dabali-qr-v1:${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`;
  if (s.length < 40) throw new Error("Aucune clé de signature QR disponible");
  return s;
}
