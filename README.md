# Dabali

Cantine connectée : porte-monnaie prépayé, tickets QR à usage unique, menu illustré, dashboard de gestion
et suivi d'affluence par vision (YOLO). Projet du **Hackathon Restauration Vatel** — 21 novembre 2026.

> Architecture, arborescence et décisions : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## État d'avancement

| Bloc | État |
|---|---|
| Schéma Postgres, RLS, droits de colonne | ✅ |
| RPC : recharge, caisse, achat, annulation, transfert + PIN, scan, expiration, menus, stock, avis | ✅ |
| Edge Functions `ticket-token` / `redeem-ticket` (QR signés HMAC) | ✅ |
| Tests §12 (SQL + concurrence + QR) | ✅ 184 vérifications |
| Seed de démo (§10) | ⏳ |
| Appli Next.js (`/app`, `/scan`, `/admin`) | ⏳ |
| Module vision | ⏳ |

## Base de données

### Déployer sur Supabase

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push
npx supabase secrets set QR_HMAC_SECRET="$(openssl rand -base64 48)" ALLOWED_ORIGIN=https://<site>.netlify.app
npx supabase functions deploy ticket-token
npx supabase functions deploy redeem-ticket
```

La migration `…_platform.sql` planifie les crons (`pg_cron` : expiration des tickets toutes les 5 min, contrôle
de la date limite du menu toutes les heures), ajoute les tables au Realtime et crée le bucket `dishes`.

### Lancer les tests en local

Il suffit d'un Postgres ≥ 15 (les tests simulent `auth.uid()` et les rôles Supabase) et de Node ≥ 22.18.

```bash
PGHOST=localhost PGPORT=5432 PGUSER=postgres supabase/tests/run.sh
```

Couverture des critères d'acceptation (§12) :

| Critère | Test |
|---|---|
| 2e scan refusé, y compris 10 scanners simultanés | `30_tickets_redeem.sql`, `concurrency.sh` |
| QR modifié refusé | `qr.test.ts` (chaque caractère altéré), nonce faux dans `30_…` |
| Solde jamais négatif ; somme des transactions = solde | `tests.check_ledger()` à la fin de chaque fichier, achats concurrents |
| PIN faux → échec ; 3 PIN faux → blocage 15 min (persistant entre requêtes) | `20_transfer_pin.sql`, `concurrency.sh` |
| Ticket non utilisé → expiré après le service | `30_tickets_redeem.sql` |
| Menu non soumis mercredi 23h59 → alerte admin | `40_menu_rls.sql` |
| Pas de survente de la dernière portion | `concurrency.sh` |

### Règles pour le front

- **Ne jamais écrire** dans `wallets`, `transactions`, `tickets` : uniquement les RPC (`supabase.rpc(...)`).
- Les RPC renvoient `{ ok: true, … }` ou `{ ok: false, code, message }` — afficher `message` (déjà en français).
- `tickets` et `profiles` ont des droits par colonne (`qr_nonce`, `pin_hash` cachés) : **lister les colonnes**
  dans `select(...)`, pas de `select('*')`.
- Les QR s'obtiennent via l'Edge Function `ticket-token` (à mettre en cache pour le mode hors ligne).

## Variables d'environnement

Voir [.env.example](.env.example). `QR_HMAC_SECRET` et `SUPABASE_SERVICE_ROLE_KEY` ne doivent **jamais**
être exposées au navigateur (pas de préfixe `NEXT_PUBLIC_`).

## Comptes de démo

À venir avec le seed.
