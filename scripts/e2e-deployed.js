// Parcours complet sur le site déployé : connexion client → achat → QR → scan agent (×2) → ticket vert.
// Usage : BASE=https://dabalix.netlify.app node scripts/e2e-deployed.js [dossier_captures]
// Consomme un ticket de démo (achat réel sur le compte client@dabali.ci).
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE || "https://dabalix.netlify.app";
const OUT = process.argv[2] || ".";

(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const ctx = await b.newContext({ ...devices["Pixel 7"], deviceScaleFactor: 1, ignoreHTTPSErrors: !!process.env.HTTPS_PROXY, locale: "fr-FR", timezoneId: "Africa/Abidjan" });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const step = (s) => console.log("•", s);

  await p.goto(BASE + "/connexion");
  await p.getByRole("button", { name: "Client" }).click();
  await p.waitForURL("**/app", { timeout: 30000 });
  await p.waitForTimeout(2500);
  const balance0 = await p.locator("text=/\\d[\\d\\s\\u00a0]*[\\s\\u00a0]FCFA/").first().textContent();
  step(`connecté · solde affiché ${balance0}`);
  await p.screenshot({ path: `${OUT}/1-accueil.png` });

  // Menu : premier jour à venir disponible, déjeuner, premier plat achetable
  await p.goto(BASE + "/app/menu");
  await p.waitForTimeout(3000);
  const days = p.locator("header button:not([disabled])").filter({ hasText: /^\D+\d+$/ });
  await days.nth(Math.min(1, (await days.count()) - 1)).click();
  await p.getByRole("button", { name: "Déjeuner" }).click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/2-menu.png` });
  await p.locator('a[href^="/app/menu/"]').first().click();
  await p.waitForTimeout(2500);
  const dish = (await p.locator("h1").first().textContent()).trim();
  step(`fiche plat : ${dish}`);
  await p.screenshot({ path: `${OUT}/3-fiche.png` });

  await p.getByRole("button", { name: /^Acheter/ }).click();
  await p.waitForURL("**/app/tickets/**", { timeout: 20000 });
  await p.waitForTimeout(4000);
  const ticketId = p.url().split("/app/tickets/")[1].split("?")[0];
  step(`ticket acheté ${ticketId.slice(0, 8)}…`);
  await p.screenshot({ path: `${OUT}/4-qr.png` });

  // Jeton QR (celui que l'écran affiche, mis en cache pour le hors-ligne)
  const token = await p.evaluate((id) => JSON.parse(localStorage.getItem("dabali:qr"))[id].token, ticketId);
  // Agent : nouveau contexte (autre téléphone)
  const agentCtx = await b.newContext({ ...devices["Pixel 7"], ignoreHTTPSErrors: !!process.env.HTTPS_PROXY });
  const a = await agentCtx.newPage();
  await a.goto(BASE + "/connexion");
  await a.getByRole("button", { name: "Agent" }).click();
  await a.waitForURL("**/scan", { timeout: 30000 });
  step("agent connecté sur /scan");
  const scan = (tok, date, service) => a.evaluate(async ({ tok, date, service }) => {
    const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
    let session = key && JSON.parse(localStorage.getItem(key));
    if (!session) {
      const c = document.cookie.split("; ").filter((x) => x.startsWith("sb-")).map((x) => decodeURIComponent(x.split("=").slice(1).join("=")));
      const raw = c.join("");
      session = JSON.parse(raw.startsWith("base64-") ? atob(raw.slice(7)) : raw);
    }
    const r = await fetch("https://punghxwtknejxkedaoty.supabase.co/functions/v1/redeem-ticket", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ token: tok, service_date: date, service }),
    });
    return r.json();
  }, { tok, date, service });

  const meta = await p.evaluate((id) => JSON.parse(localStorage.getItem("dabali:tickets")).find((t) => t.id === id), ticketId);
  const r1 = await scan(token, meta.service_date, meta.service);
  step(`1er scan : ${r1.ok ? "ACCEPTÉ — " + r1.client + " · " + r1.dish : "refusé " + r1.message}`);
  const r2 = await scan(token, meta.service_date, meta.service);
  step(`2e scan : ${r2.ok ? "ACCEPTÉ (anormal !)" : "refusé — " + r2.message}`);
  const forged = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
  const r3 = await scan(forged, meta.service_date, meta.service);
  step(`QR falsifié : ${r3.ok ? "ACCEPTÉ (anormal !)" : "refusé — " + r3.message}`);

  // Côté client : l'écran passe au vert sans recharger
  await p.waitForSelector("text=Bon appétit", { timeout: 15000 }).then(() => step("écran client : « Bon appétit ! » affiché en direct")).catch(() => step("écran client : pas de passage au vert détecté"));
  await p.screenshot({ path: `${OUT}/5-scanne.png` });

  console.log(errors.length ? "Erreurs JS : " + errors.join(" | ") : "Aucune erreur JavaScript");
  console.log(r1.ok && !r2.ok && !r3.ok ? "✅ PARCOURS OK" : "❌ PARCOURS EN ÉCHEC");
  await b.close();
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
