// POST /functions/v1/forecast-assistant  { date: "AAAA-MM-JJ", refresh?: boolean }
// Assistant IA du chef : lit les prévisions (admin_forecast) et l'historique de gaspillage,
// puis demande à Claude un brief clair en français (quoi préparer, quoi acheter, points de vigilance).
// Réservé à la cuisine / l'admin. Résultat mis en cache par jour tant que les prévisions ne changent pas.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { adminClient, corsHeaders, fail, json } from "../_shared/http.ts";

const MODEL = "claude-opus-5-5";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titre", "resume", "actions", "achats", "vigilance"],
  properties: {
    titre: { type: "string", description: "Phrase courte qui résume la journée (moins de 12 mots)" },
    resume: { type: "string", description: "2 ou 3 phrases pour le chef : volume attendu et pourquoi" },
    actions: {
      type: "array",
      description: "3 à 6 actions concrètes, les plus importantes d'abord",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["priorite", "titre", "detail"],
        properties: {
          priorite: { type: "string", enum: ["haute", "moyenne", "basse"] },
          titre: { type: "string" },
          detail: { type: "string" },
        },
      },
    },
    achats: { type: "string", description: "Liste de courses résumée en une ou deux phrases, avec le budget" },
    vigilance: { type: "array", items: { type: "string" }, description: "0 à 3 risques à surveiller" },
  },
} as const;

const SYSTEM = `Tu es l'assistant de production de Dabali, la cantine d'une école hôtelière à Abidjan.
Tu aides le chef à décider combien préparer et quoi acheter pour un jour donné, avec un objectif : ne rien jeter sans laisser d'étudiant sans repas.
Les données viennent du système de prévision :
- services[] : repas attendus par service (expected), moyenne des 4 mêmes jours de semaine (history, null si pas d'historique), tickets déjà achetés et valables ce jour (outstanding).
- items[] : par plat, part des choix au comptoir (share, %), repas attendus (expected), portions recommandées avec 5 % de marge (recommended), portions prévues au menu par le chef (planned, null = illimité).
- ingredients[] : besoin des recettes, stock, quantité à acheter et coût (FCFA).
- gaspillage[] : sur les mêmes jours de semaine passés, portions préparées vs servies par plat.
Règles : réponds en français simple, direct, comme un second de cuisine. Cite les chiffres. Signale les plats où le prévu au menu est très au-dessus (gaspillage) ou en dessous (rupture) de la recommandation. Ne propose que des actions faisables le jour même ou la veille. N'invente aucun chiffre absent des données. Montants en FCFA.`;

async function sha256(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("METHOD", "POST uniquement", 405);
  const auth = req.headers.get("Authorization");
  if (!auth) return fail("AUTH_REQUIRED", "Connexion requise.", 401);

  const body = await req.json().catch(() => ({}));
  const date = String(body?.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("BAD_DATE", "Date invalide.");

  // Prévisions lues avec le JWT de l'appelant : admin_forecast vérifie le rôle (chef / admin).
  const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: forecast, error } = await userDb.rpc("admin_forecast", { p_date: date });
  if (error) return fail("FORBIDDEN", "Réservé à la cuisine et à l'administration.", 403);

  const db = adminClient();
  const past = [7, 14, 21, 28].map((d) => new Date(Date.parse(date) - d * 864e5).toISOString().slice(0, 10));
  const { data: waste } = await db.from("menu_items")
    .select("service_date, service, prepared_qty, served_qty, dish:dishes(name), menu:menus!inner(status)")
    .in("service_date", past).eq("menu.status", "published").not("prepared_qty", "is", null);
  const gaspillage = (waste ?? []).map((w: any) => ({
    date: w.service_date, service: w.service, plat: w.dish?.name, prepare: w.prepared_qty, servi: w.served_qty,
  }));

  const dayName = new Date(date + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const input = JSON.stringify({ jour: dayName, date, previsions: forecast, gaspillage });
  const hash = await sha256(input);

  if (!body?.refresh) {
    const { data: cached } = await db.from("ai_forecast_briefs").select("brief, created_at, input_hash").eq("service_date", date).maybeSingle();
    if (cached && cached.input_hash === hash) return json({ ok: true, cached: true, created_at: cached.created_at, brief: cached.brief });
  }

  let apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) apiKey = (await db.rpc("_anthropic_key")).data ?? undefined;
  if (!apiKey) return fail("NO_KEY", "Clé Anthropic non configurée.", 500);

  const client = new Anthropic({ apiKey });
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `Prépare le brief de production pour ${dayName}.\n\n<donnees>\n${input}\n</donnees>` }],
    } as any);
    if (res.stop_reason === "refusal") return fail("AI_REFUSED", "L'assistant n'a pas pu analyser cette journée.", 502);
    const text = res.content.find((b: any) => b.type === "text") as { text: string } | undefined;
    if (!text) return fail("AI_EMPTY", "Réponse vide de l'assistant.", 502);
    const brief = JSON.parse(text.text);
    const created_at = new Date().toISOString();
    await db.from("ai_forecast_briefs").upsert({ service_date: date, input_hash: hash, brief, model: res.model, created_at });
    return json({ ok: true, cached: false, created_at, brief });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fail("AI_AUTH", "Clé Anthropic refusée.", 502);
    if (e instanceof Anthropic.RateLimitError) return fail("AI_BUSY", "Assistant saturé, réessayez dans une minute.", 503);
    if (e instanceof Anthropic.APIError) return fail("AI_ERROR", `Erreur de l'assistant (${e.status}).`, 502);
    return fail("AI_ERROR", "L'assistant est indisponible.", 502);
  }
});
