# Dabali

Cantine connectée : porte-monnaie prépayé, tickets QR à usage unique, menu illustré, dashboard de gestion
et suivi d'affluence par vision (YOLO). Projet du **Hackathon Restauration Vatel** — 21 novembre 2026.

> **Site en ligne : https://dabalix.netlify.app** · Architecture et décisions : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Ce qui est en place

| Espace | Contenu |
|---|---|
| **`/app`** — appli client (PWA mobile) | Solde temps réel, recharge (Mobile Money simulé), menu de la semaine (ruptures en direct), achat de tickets **par type de repas** (petit-déjeuner 500, déjeuner 2 500, snack 700, dîner 2 500 FCFA ; 1 à 10 tickets ; entrée/dessert en supplément ; valables 48 h ; PIN au-delà de 5 000 FCFA), « Offrir des tickets », tickets QR (hors ligne, passage au vert au scan, avis), transfert avec PIN, historique, fidélité (10 points = 1 petit-déjeuner offert), affluence du réfectoire, notifications |
| **`/scan`** — scanner agent | Caméra plein écran, onglet par service, écran vert / rouge + son, motif du refus ; après validation l'agent touche le plat choisi par le client (stock et portions décomptés) ; compteur servis / en circulation |
| **`/admin`** — dashboard équipe | Vue d'ensemble temps réel, caisse (crédit espèces + reçu), menu hebdo (soumission, publication, date limite), plats + photos + recettes, prévisions + liste de courses, stock, ventes + CSV, gaspillage, avis, affluence (plan de salle), équipe + journal, paramètres |
| **Popularité des plats** | Les prévisions répartissent les repas entre plats selon leur popularité : choix réels au comptoir (8 semaines, majorés quand le plat était épuisé) mélangés à une popularité de départ réglable par plat (initialisée d'après les enquêtes disponibles et le terrain : alloco, attiéké, garba très demandés ; riz moins), ajustée par les avis |
| **Argent des tickets** | L'argent d'un ticket ne revient au prestataire qu'au **scan** (repas servi). Tableau de bord : « Encaissé · repas servis » = valeur des tickets scannés, « En attente » = tickets valides pas encore scannés. Ticket jamais scanné : **remboursé automatiquement** sur le solde à l'expiration (48 h), après un rappel 3 h avant ; un ticket offert rend ses points |
| **Courses** | Fiche de courses automatique : dès qu'un ingrédient passe sous son seuil (et toutes les 15 min), la prochaine fiche se remplit avec ce qu'il faut pour les menus des 2 prochains jours + le seuil, sans recommander ce qui est déjà en cours d'achat. La cuisine ajoute ses articles libres, puis envoie la fiche à un employé (notifié). Sur `/courses`, il coche, note les prix, signale l'introuvable ; à la fin, le stock est crédité et le manquant repart sur la fiche suivante. Les oublis après le départ passent par un « ajout urgent » qui s'affiche en direct sur son téléphone |
| **Assistant IA** | Page Prévisions : brief du chef généré par Claude (Edge Function `forecast-assistant`) à partir des prévisions et du gaspillage des 4 mêmes jours passés — quoi préparer, quoi acheter, risques. Mis en cache par jour. Clé : secret `ANTHROPIC_API_KEY` ou, à défaut, Supabase Vault (`select vault.create_secret('<clé>', 'anthropic_api_key')`) |
| **Supabase** | Schéma, RLS partout, RPC transactionnelles, Edge Functions QR signés HMAC, crons, Realtime |
| **`vision/`** | YOLO11n + OpenCV, zones-tables, lissage 30 s / 60 s, envoi de chiffres uniquement |

## Comptes de démo

Mot de passe commun : **`Dabali2026!`** — boutons « Comptes de démo » sur l'écran de connexion.

| Rôle | E-mail | Remarque |
|---|---|---|
| Client | `client@dabali.ci` | Aya Konan · identifiant **DB-2026** · PIN **2580** · 12 points |
| Agent | `agent@dabali.ci` | ouvre directement `/scan` |
| Caisse | `caisse@dabali.ci` | |
| Chef | `chef@dabali.ci` | |
| Admin | `admin@dabali.ci` | accès à tout |
| 29 autres clients | `client01@dabali.ci` … `client29@dabali.ci` | |

## Lancer en local

```bash
npm install
npm run dev
```

L'appli pointe par défaut sur le projet Supabase `punghxwtknejxkedaoty` (URL + clé anon publiques dans
`src/lib/config.ts`, surchargeables via `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
La caméra (`/scan`) exige HTTPS sur téléphone : tester via le site déployé ou un tunnel HTTPS.

## Base de données

Migrations dans `supabase/migrations/` (déjà appliquées sur le projet), seed dans `supabase/seed.sql`.

```bash
npx supabase link --project-ref punghxwtknejxkedaoty
npx supabase db push
npx supabase functions deploy ticket-token
npx supabase functions deploy redeem-ticket
```

**Signature des QR** : les Edge Functions utilisent `QR_HMAC_SECRET` s'il est défini
(`npx supabase secrets set QR_HMAC_SECRET="$(openssl rand -base64 48)"`), sinon une clé dérivée de la clé
`service_role`, injectée par Supabase côté serveur uniquement. Changer la clé invalide les QR en cache.

### Tests

Postgres ≥ 15 et Node ≥ 22.18 suffisent (les tests simulent `auth.uid()` et les rôles Supabase) :

```bash
PGHOST=localhost PGUSER=postgres supabase/tests/run.sh      # 191 vérifications SQL + QR + concurrence
SUPABASE_URL=… SUPABASE_ANON_KEY=… scripts/smoke-remote.sh  # API bout en bout (consomme un ticket de démo)
BASE=https://dabalix.netlify.app SCAN_DATE=AAAA-MM-JJ node scripts/e2e-deployed.js  # parcours complet dans un navigateur sur le site en ligne
python -m pytest vision/ -q                                 # module vision
```

| Critère §12 | Vérifié par |
|---|---|
| 2e scan refusé, même sur 10 scanners simultanés | `30_tickets_redeem.sql`, `concurrency.sh`, `smoke-remote.sh` |
| QR modifié à la main refusé | `qr.test.ts` (chaque caractère), `smoke-remote.sh` |
| Solde jamais négatif ; somme des transactions = solde | `tests.check_ledger()`, achats concurrents, seed |
| PIN faux refusé ; 3 PIN faux → blocage 15 min | `20_transfer_pin.sql`, `concurrency.sh` |
| Plat épuisé grisé sans recharger | mesuré : 0,3 s entre la rupture en base et le plat grisé dans l'appli (Realtime) |
| Ticket non utilisé → rouge après son service | `30_tickets_redeem.sql` + affichage immédiat côté appli |
| QR affiché en mode avion | test Playwright hors ligne (service worker + cache local des jetons) |
| Menu non soumis mercredi 23h59 → alerte admin | `40_menu_rls.sql` (cron horaire) |
| Aucune image écrite par le module vision | `vision/test_occupancy.py` |
| PWA installable, utilisable en 360 px | manifeste + icônes + service worker ; maquettes testées au format Pixel 7 |

## Module vision (affluence)

```bash
cd vision
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # SUPABASE_SERVICE_ROLE_KEY + ROOM_ID (select id from rooms)
python calibrate.py --source demo.mp4      # cliquer les coins de chaque table → zones.json
python occupancy.py --source demo.mp4 --preview
```

Sources acceptées : webcam (`0`), fichier vidéo, flux RTSP, ou téléphone Android avec *IP Webcam*
(`http://IP:8080/video`). Une image analysée toutes les 2 s, un relevé envoyé toutes les 10 s. Sans relevé
depuis 2 minutes, l'appli bascule sur une estimation à partir du rythme des scans.

## Variables d'environnement

Voir [.env.example](.env.example) et [vision/.env.example](vision/.env.example).
La clé `service_role` ne doit **jamais** être exposée au navigateur (pas de préfixe `NEXT_PUBLIC_`).

## Règles pour le code front

- Aucune écriture dans `wallets`, `transactions`, `tickets` : uniquement les RPC (`rpc(...)` dans `src/lib/supabase/client.ts`).
- Les RPC renvoient `{ ok: true, … }` ou `{ ok: false, code, message }` : afficher `message` (déjà en français).
- `tickets` et `profiles` ont des droits par colonne : lister les colonnes, pas de `select('*')`.

## Phase 2 (hors hackathon)

Mobile Money réel (CinetPay…), OTP SMS, scanner hors ligne avec file de synchronisation, planning des équipes,
multi-établissements, notifications push (table `push_subscriptions` prête).
