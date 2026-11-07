// Parcours complet v2 sur le site déployé : connexion client → achat d'un ticket Déjeuner → QR
// → scan agent (validation + plat choisi au comptoir) → 2e scan refusé → QR falsifié refusé → ticket vert.
// Usage : BASE=https://dabalix.netlify.app SCAN_DATE=AAAA-MM-JJ node scripts/e2e-deployed.js [dossier_captures]
// SCAN_DATE : jour avec un menu déjeuner publié (par défaut aujourd'hui). Consomme un ticket réel du compte de démo.
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE || "https://dabalix.netlify.app";
const OUT = process.argv[2] || ".";
const SB = "https://punghxwtknejxkedaoty.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1bmdoeHd0a25lanhrZWRhb3R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5ODI5MDEsImV4cCI6MjEwOTU1ODkwMX0.6a92Pd0x-vmGKsZnfEa-nLRuKQRa92ERbqY6uukdMsY";
const SCAN_DATE = process.env.SCAN_DATE || new Date().toISOString().slice(0, 10);

// Exécuté dans la page : lit la session Supabase (cookies sb-*) et appelle l'API
async function call({ url, body, anon }) {
  const c = document.cookie.split("; ").filter((x) => x.startsWith("sb-")).sort().map((x) => decodeURIComponent(x.split("=").slice(1).join("=")));
  const raw = c.join("");
  const session = JSON.parse(raw.startsWith("base64-") ? atob(raw.slice(7)) : raw);
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  return r.json();
}

(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const opts = { ...devices["Pixel 7"], deviceScaleFactor: 1, ignoreHTTPSErrors: !!process.env.HTTPS_PROXY, locale: "fr-FR", timezoneId: "Africa/Abidjan" };
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const step = (s) => console.log("•", s);

  await p.goto(BASE + "/connexion");
  await p.getByRole("button", { name: "Client" }).click();
  await p.waitForURL("**/app", { timeout: 30000 });
  await p.waitForTimeout(2500);
  step("client connecté");
  await p.screenshot({ path: `${OUT}/1-accueil.png` });

  await p.goto(BASE + "/app/tickets");
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${OUT}/2-tickets.png` });

  // Achat : 1 ticket Déjeuner, sans supplément
  await p.goto(BASE + "/app/acheter?service=lunch");
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${OUT}/3-acheter.png` });
  await p.getByRole("button", { name: /ticket.*Déjeuner/ }).click();
  await p.waitForURL("**/app/tickets/**", { timeout: 20000 });
  await p.waitForTimeout(4000);
  const ticketId = p.url().split("/app/tickets/")[1].split("?")[0];
  step(`ticket Déjeuner acheté ${ticketId.slice(0, 8)}…`);
  await p.screenshot({ path: `${OUT}/4-qr.png` });

  const token = await p.evaluate((id) => JSON.parse(localStorage.getItem("dabali:qr"))[id].token, ticketId);

  // Agent : autre téléphone
  const agentCtx = await b.newContext(opts);
  const a = await agentCtx.newPage();
  await a.goto(BASE + "/connexion");
  await a.getByRole("button", { name: "Agent" }).click();
  await a.waitForURL("**/scan", { timeout: 30000 });
  await a.waitForTimeout(2000);
  step("agent connecté sur /scan");
  await a.screenshot({ path: `${OUT}/5-scanner.png` });

  const scan = (tok) => a.evaluate(call, { url: `${SB}/functions/v1/redeem-ticket`, anon: ANON, body: { token: tok, service_date: SCAN_DATE, service: "lunch" } });

  const r1 = await scan(token);
  step(`1er scan (${SCAN_DATE}) : ${r1.ok ? `ACCEPTÉ — ${r1.client} · ${r1.dishes?.length ?? 0} plats proposés` : "refusé " + r1.message}`);
  let served = { ok: false };
  if (r1.ok) {
    const dish = (r1.dishes || []).find((d) => d.available);
    if (dish) {
      served = await a.evaluate(call, { url: `${SB}/rest/v1/rpc/serve_dish`, anon: ANON, body: { p_ticket_id: r1.ticket_id, p_menu_item_id: dish.menu_item_id } });
      step(`plat servi : ${served.ok ? served.dish : "refus " + served.message}`);
    } else step("aucun plat disponible ce jour-là");
  }
  const r2 = await scan(token);
  step(`2e scan : ${r2.ok ? "ACCEPTÉ (anormal !)" : "refusé — " + r2.message}`);
  const forged = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
  const r3 = await scan(forged);
  step(`QR falsifié : ${r3.ok ? "ACCEPTÉ (anormal !)" : "refusé — " + r3.message}`);

  await p.waitForSelector("text=Bon appétit", { timeout: 15000 }).then(() => step("écran client : « Bon appétit ! » affiché en direct")).catch(() => step("écran client : pas de passage au vert détecté"));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/6-scanne.png` });

  console.log(errors.length ? "Erreurs JS : " + errors.join(" | ") : "Aucune erreur JavaScript");
  console.log(r1.ok && served.ok && !r2.ok && !r3.ok ? "✅ PARCOURS OK" : "❌ PARCOURS EN ÉCHEC");
  await b.close();
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
