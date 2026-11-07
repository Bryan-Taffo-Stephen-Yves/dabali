// POST /functions/v1/shopping-organize  { list_id }
// Range une fiche de courses par rayon de supermarché (ordre de parcours, surgelés à la fin)
// et propose le conditionnement à acheter (« 60 œufs » → « 2 plateaux de 30 »).
// Autorisé au chef / à l'admin, et à l'employé à qui la fiche est attribuée.
import Anthropic from "npm:@anthropic-ai/sdk";
import { adminClient, corsHeaders, fail, json, requestUser } from "../_shared/http.ts";

const MODEL = "claude-opus-5-5";
export const AISLES = [
  "Fruits & légumes", "Boulangerie", "Boucherie & volaille", "Poissonnerie", "Épicerie salée", "Huiles & condiments",
  "Épicerie sucrée", "Boissons", "Crèmerie & œufs", "Hygiène & entretien", "Surgelés", "Marché / autre",
] as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "rayon", "conditionnement"],
        properties: {
          id: { type: "string" },
          rayon: { type: "string", enum: [...AISLES] },
          conditionnement: { type: "string", description: "Ce qu'il faut prendre en rayon, en conditionnements courants, moins de 60 caractères. Vide si la quantité se prend telle quelle." },
        },
      },
    },
  },
} as const;

const SYSTEM = `Tu prépares la liste de courses d'une cantine scolaire d'Abidjan pour un employé qui va au supermarché (Carrefour, Prosuma, Super U…) ou au marché.
Pour chaque article, choisis le rayon où il se trouve, parmi la liste imposée, et indique le conditionnement à prendre en rayon pour couvrir la quantité demandée, sans en prendre beaucoup trop :
- œufs en plateaux de 30 ; huile en bidons de 5 L ou bouteilles de 1 L ; riz en sacs de 5 ou 25 kg ; farine et sucre en paquets de 1 kg ; lait en briques de 1 L ; pâte d'arachide en pots ; frites surgelées en sachets de 1 ou 2,5 kg ;
- poisson, viande, poulet, légumes et feuilles : au poids, demander « X kg » au comptoir ou au marché ;
- produits typiquement ivoiriens (attiéké, banane plantain, graine de palme, feuilles de kplala, manioc) : rayon « Marché / autre » si un supermarché ne les vend pas d'habitude, sinon « Fruits & légumes ».
Écris en français, court, avec les quantités en chiffres (ex. « 2 plateaux de 30 », « 1 bidon de 5 L + 1 bouteille de 1 L », « 10 kg au comptoir »). Garde chaque id tel quel et renvoie tous les articles.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("METHOD", "POST uniquement", 405);
  const user = await requestUser(req);
  if (!user) return fail("AUTH_REQUIRED", "Connexion requise.", 401);
  const body = await req.json().catch(() => ({}));
  const listId = String(body?.list_id ?? "");

  const db = adminClient();
  const [{ data: list }, { data: me }] = await Promise.all([
    db.from("shopping_lists").select("id, status, assigned_to").eq("id", listId).maybeSingle(),
    db.from("profiles").select("role, is_blocked").eq("id", user.id).single(),
  ]);
  if (!list) return fail("NOT_FOUND", "Fiche introuvable.", 404);
  const allowed = !me?.is_blocked && (me?.role === "chef" || me?.role === "admin" || list.assigned_to === user.id);
  if (!allowed) return fail("FORBIDDEN", "Cette fiche ne vous est pas attribuée.", 403);
  if (list.status === "done" || list.status === "cancelled") return fail("LIST_CLOSED", "Cette fiche est terminée.");

  const { data: items } = await db.from("shopping_items").select("id, label, qty, unit").eq("list_id", listId);
  if (!items?.length) return fail("EMPTY", "La fiche est vide.");

  let apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) apiKey = (await db.rpc("_anthropic_key")).data ?? undefined;
  if (!apiKey) return fail("NO_KEY", "Clé Anthropic non configurée.", 500);

  const client = new Anthropic({ apiKey });
  let out: { items: { id: string; rayon: string; conditionnement: string }[] };
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `<articles>\n${JSON.stringify(items.map((i) => ({ id: i.id, article: i.label, quantite: Number(i.qty), unite: i.unit })))}\n</articles>` }],
    } as any);
    if (res.stop_reason === "refusal") return fail("AI_REFUSED", "L'assistant n'a pas pu ranger cette fiche.", 502);
    const text = res.content.find((b: any) => b.type === "text") as { text: string } | undefined;
    if (!text) return fail("AI_EMPTY", "Réponse vide de l'assistant.", 502);
    out = JSON.parse(text.text);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fail("AI_AUTH", "Clé Anthropic refusée.", 502);
    if (e instanceof Anthropic.RateLimitError) return fail("AI_BUSY", "Assistant saturé, réessayez dans une minute.", 503);
    if (e instanceof Anthropic.APIError) return fail("AI_ERROR", `Erreur de l'assistant (${e.status}).`, 502);
    return fail("AI_ERROR", "L'assistant est indisponible.", 502);
  }

  // Seuls les articles de cette fiche sont mis à jour, avec un rayon de la liste imposée
  const ids = new Set(items.map((i) => i.id));
  const valid = out.items.filter((x) => ids.has(x.id) && (AISLES as readonly string[]).includes(x.rayon));
  await Promise.all(valid.map((x) =>
    db.from("shopping_items").update({ aisle: x.rayon, pack_hint: x.conditionnement.trim().slice(0, 120) || null }).eq("id", x.id).eq("list_id", listId)));
  await db.from("shopping_lists").update({ organized_at: new Date().toISOString() }).eq("id", listId);
  return json({ ok: true, organized: valid.length, total: items.length });
});
