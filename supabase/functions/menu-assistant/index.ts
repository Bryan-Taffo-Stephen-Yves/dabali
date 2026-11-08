// POST /functions/v1/menu-assistant  { week_start: "AAAA-MM-JJ" }
// Agent IA du chef : propose le menu de la semaine (lundi → samedi) à partir de la popularité des plats,
// des notes et plaintes, du coût des recettes, du stock, des repas attendus et des menus récents (variété).
// Ne modifie rien : renvoie une proposition que le chef valide (apply_menu_proposal).
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { adminClient, corsHeaders, fail } from "../_shared/http.ts";

const MODEL = "claude-opus-5-5";
const SERVICES = ["breakfast", "lunch", "snack", "dinner"] as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resume", "items", "explications"],
  properties: {
    resume: { type: "string", description: "2 phrases : l'idée générale de la semaine" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "service", "dish_id", "planned_qty"],
        properties: {
          date: { type: "string", description: "AAAA-MM-JJ, un des jours fournis" },
          service: { type: "string", enum: [...SERVICES] },
          dish_id: { type: "string", description: "id exact d'un plat fourni" },
          planned_qty: { type: "integer", description: "portions prévues" },
        },
      },
    },
    explications: { type: "array", items: { type: "string" }, description: "4 à 6 choix expliqués, avec les chiffres" },
  },
} as const;

const SYSTEM = `Tu es le chef adjoint de Dabali, la cantine d'une école hôtelière à Abidjan. Tu proposes le menu de la semaine.
Règles impératives :
- N'utilise que les plats fournis, chacun seulement dans ses services_possibles, et seulement les jours/services listés dans « jours ».
- Par jour : petit-déjeuner 3 plats ; déjeuner 5 ou 6 plats ; snack 3 plats ; dîner 4 ou 5 plats.
- Variété : pas le même plat au même service deux jours de suite ; un plat du déjeuner n'est pas repris au dîner le même jour ; varie par rapport aux menus récents.
- Les plats populaires (popularité > 1,2) reviennent 2 à 3 fois dans la semaine ; les plats avec beaucoup de plaintes ou une note < 3,8 au plus une fois ; un plat dont un ingrédient est en rupture : évite-le en début de semaine.
- Au déjeuner, garde chaque jour au moins une option légère ou végétarienne (catégorie Végétarien ou salade).
- Portions prévues (planned_qty) : répartis les repas attendus du service ce jour-là entre ses plats selon leur popularité, + 5 % de marge, arrondi ; à défaut d'historique, 20 à 30 portions par plat.
Les explications sont en français simple, avec les chiffres (popularité, note, plaintes, coût).`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("METHOD", "POST uniquement", 405);
  const auth = req.headers.get("Authorization");
  if (!auth) return fail("AUTH_REQUIRED", "Connexion requise.", 401);
  const body = await req.json().catch(() => ({}));
  const week = String(body?.week_start ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || new Date(week + "T12:00:00Z").getUTCDay() !== 1) return fail("BAD_WEEK", "Semaine invalide (lundi attendu).");

  // Contexte lu avec le JWT du chef : menu_ai_context vérifie le rôle (et la double authentification si exigée)
  const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: ctx, error } = await userDb.rpc("menu_ai_context", { p_week_start: week });
  if (error || !ctx) return fail("FORBIDDEN", "Réservé à la cuisine.", 403);

  // Le calcul dure ~1 min : la réponse est un flux qui envoie un espace toutes les 10 s (JSON valide une fois complet),
  // sinon certains navigateurs / réseaux coupent une connexion silencieuse.
  const work = (async () => {
    let apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) apiKey = (await adminClient().rpc("_anthropic_key")).data ?? undefined;
    if (!apiKey) return { ok: false, code: "NO_KEY", message: "Clé Anthropic non configurée." };

    let out: { resume: string; items: { date: string; service: string; dish_id: string; planned_qty: number }[]; explications: string[] };
    try {
      const client = new Anthropic({ apiKey });
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: "user", content: `Propose le menu de la semaine du ${week}.\n\n<donnees>\n${JSON.stringify(ctx)}\n</donnees>` }],
      } as any);
      const res = await stream.finalMessage();
      if (res.stop_reason === "refusal") return { ok: false, code: "AI_REFUSED", message: "L'assistant n'a pas pu proposer de menu." };
      const text = res.content.find((b: any) => b.type === "text") as { text: string } | undefined;
      if (!text) return { ok: false, code: "AI_EMPTY", message: "Réponse vide de l'assistant." };
      out = JSON.parse(text.text);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return { ok: false, code: "AI_AUTH", message: "Clé Anthropic refusée." };
      if (e instanceof Anthropic.RateLimitError) return { ok: false, code: "AI_BUSY", message: "Assistant saturé, réessayez dans une minute." };
      if (e instanceof Anthropic.APIError) return { ok: false, code: "AI_ERROR", message: `Erreur de l'assistant (${e.status}).` };
      return { ok: false, code: "AI_ERROR", message: "L'assistant est indisponible." };
    }

    // Garde-fous : seulement des plats connus, dans leurs services, aux jours prévus, sans doublon
    const dishes = new Map<string, { nom: string; services_possibles: string[] }>((ctx.plats ?? []).map((p: any) => [p.id, p]));
    const allowed = new Map<string, string[]>((ctx.jours ?? []).map((j: any) => [j.date, j.services]));
    const seen = new Set<string>();
    const items = out.items.filter((x) => {
      const d = dishes.get(x.dish_id); const k = `${x.date}|${x.service}|${x.dish_id}`;
      const ok = d && d.services_possibles.includes(x.service) && allowed.get(x.date)?.includes(x.service) && !seen.has(k);
      seen.add(k);
      return ok;
    }).map((x) => ({ ...x, planned_qty: Math.min(Math.max(Math.round(x.planned_qty || 20), 5), 500), dish: dishes.get(x.dish_id)!.nom }));

    return { ok: true, week_start: week, resume: out.resume, explications: out.explications, items, rejected: out.items.length - items.length };
  })();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      ctrl.enqueue(enc.encode(" "));
      const beat = setInterval(() => ctrl.enqueue(enc.encode(" ")), 10_000);
      try { ctrl.enqueue(enc.encode(JSON.stringify(await work))); }
      catch { ctrl.enqueue(enc.encode(JSON.stringify({ ok: false, code: "AI_ERROR", message: "L'assistant est indisponible." }))); }
      finally { clearInterval(beat); ctrl.close(); }
    },
  });
  return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
});
