# Dabali — Architecture

## Arborescence

```
dabali/
├── README.md
├── docs/
│   └── ARCHITECTURE.md            ← ce fichier
├── supabase/
│   ├── config.toml
│   ├── migrations/                ← schéma, RLS, RPC (ordre chronologique)
│   │   ├── …_types.sql / …_tables.sql      (enums, tables, paramètres par défaut)
│   │   ├── …_functions_core.sql            (PIN, recharge, caisse, transferts)
│   │   ├── …_functions_tickets_menus.sql   (achat, annulation, scan, menus, stock)
│   │   ├── …_rls_and_grants.sql
│   │   ├── …_platform.sql                  (cron, realtime, storage — ignorés hors Supabase)
│   │   ├── …_advisor_fixes.sql / …_occupancy_now.sql
│   │   └── …_dashboard.sql                 (agrégats du dashboard)
│   ├── functions/                 ← Edge Functions (Deno)
│   │   ├── _shared/qr.ts          (signature / vérification HMAC-SHA256 des QR)
│   │   ├── _shared/http.ts
│   │   ├── ticket-token/          (client : renvoie les jetons QR signés de SES tickets)
│   │   └── redeem-ticket/         (agent : vérifie la signature puis appelle redeem_ticket)
│   ├── seed.sql                   ← données de démo (§10)
│   └── tests/                     ← tests SQL (§12) exécutables sur un Postgres local
│       ├── 00_local_stubs.sql     (simule auth.*, rôles anon/authenticated/service_role)
│       ├── 01_helpers.sql         (assertions + jeu de données de test)
│       ├── 10_wallet_purchase.sql
│       ├── 20_transfer_pin.sql
│       ├── 30_tickets_redeem.sql
│       ├── 40_menu_rls.sql
│       ├── qr.test.ts             (signature HMAC, QR falsifiés)
│       ├── concurrency.sh         (scans, achats et transferts simultanés)
│       └── run.sh
├── src/                           ← Next.js App Router (une seule app)
│   ├── app/
│   │   ├── (auth)/connexion, inscription
│   │   ├── app/                   ← espace client (PWA, mobile-first)
│   │   │   ├── page.tsx           accueil : solde, affluence, mes tickets
│   │   │   ├── menu/              semaine × service × catégorie, fiche plat [id]
│   │   │   ├── tickets/[id]/      QR plein écran (cache hors ligne)
│   │   │   ├── recharger/ transferer/ historique/ profil/ notifications/
│   │   ├── scan/                  ← scanner agent plein écran
│   │   ├── admin/                 ← dashboard équipe
│   │   │   ├── page.tsx           vue d'ensemble temps réel
│   │   │   ├── plats/ menu/ previsions/ stock/ ventes/ gaspillage/
│   │   │   ├── caisse/ equipe/ avis/ affluence/ parametres/
│   │   └── manifest.ts, sw (service worker)
│   ├── components/ui/             (shadcn)
│   ├── components/{app,admin,scan}/
│   └── lib/supabase/{client,server,middleware}.ts, format.ts (FCFA, dates Abidjan), types.ts
└── vision/                        ← module Python YOLO11n (aucune image écrite)
    ├── requirements.txt
    ├── calibrate.py               (polygones de tables → zones.json)
    ├── occupancy.py               (lecture flux, détection, lissage, envoi Supabase)
    └── zones.example.json
```

## Principes de sécurité

1. **Aucune écriture client sur les soldes.** `wallets`, `transactions`, `tickets`, `ratings`, `menus.status`,
   `menu_items.sold_qty/served_qty`, `profiles.role/points/pin_*` ne sont modifiables que par des fonctions
   `SECURITY DEFINER` (verrou `FOR UPDATE`). Les droits de colonne (`GRANT UPDATE (col, …)`) complètent la RLS.
2. **RLS activée sur toutes les tables**, politiques par rôle via `has_role(...)` (l'admin passe partout).
3. **Les RPC renvoient du JSON** `{ ok: true, … }` ou `{ ok: false, code, message }` au lieu de lever une exception.
   C'est indispensable pour le PIN : un PIN faux doit *persister* le compteur d'échecs (une exception annulerait la
   transaction et donc le compteur). Toute validation se fait avant la moindre écriture financière.
4. **QR** : `DB1.<ticket_id b64url>.<nonce b64url>.<HMAC-SHA256 b64url>`. Le secret `QR_HMAC_SECRET` n'existe que
   dans les Edge Functions. Le `qr_nonce` n'est pas lisible par les clients (droit de colonne).
   `redeem_ticket` n'est exécutable que par `service_role`, donc uniquement via `redeem-ticket` après vérification.
5. **Double scan** : `UPDATE tickets SET status='used' WHERE id=… AND status='valid' AND … RETURNING` — Postgres
   sérialise les deux mises à jour sur la ligne ; la seconde voit `status='used'` et ne retourne rien.

## Tickets génériques (v2)

Un ticket n'est plus lié à un plat : il porte un **type de repas** (`service` : breakfast, lunch, snack, dinner),
ses suppléments, son prix et une validité de 48 h (`settings.ticket_validity_hours`). Prix et horaires : `settings.services`.

1. `purchase_tickets(service, quantité, suppléments, pin, bénéficiaire, récompense)` — débit unique, N tickets.
2. Au comptoir, `redeem_ticket` (via l'Edge Function, HMAC vérifié) passe le ticket à `used` et renvoie les plats du service.
3. `serve_dish(ticket, menu_item)` enregistre le plat choisi : `sold_qty`/`served_qty` +1, stock décompté, avis proposé.

`menu_items.sold_qty` compte donc les portions **servies** ; `is_full` = plat épuisé. Les prévisions répartissent
les repas attendus d'un service entre ses plats selon les choix faits au comptoir les semaines précédentes.

## Décisions à valider

| Sujet | Choix proposé | Raison |
|---|---|---|
| Point fidélité | crédité **au scan** (pas à l'achat) | §4.4 et §4.9 se contredisent ; au scan empêche de farmer des points en achetant/annulant |
| Plat épuisé | `is_sold_out` (manuel) **ou** `is_full` (colonne générée `sold_qty >= planned_qty`) | Pas d'ambiguïté quand on annule un ticket |
| PIN obligatoire | transferts, achats > 5 000, **et « Offrir un repas »** | Offrir = sortie d'argent vers un tiers |
| Annulation d'un repas offert | remboursé à l'**acheteur** | |
| Plan de salle | `occupancy_snapshots.table_states` (jsonb) + `rooms.layout` | Le schéma §8 ne stocke que des totaux |
| Montant d'une transaction | signé (+ crédit / − débit) | `somme(amount) = balance` testable directement |
| Colonnes ajoutées | `profiles.pin_failed_attempts/pin_locked_until/notify_free_seats`, `menu_items.served_qty/is_full`, `tickets.dish_id/valid_from/cancelled_at`, `ingredients.unit_cost`, tables `push_subscriptions` | Nécessaires aux §4.7, §6.7, §4.10 |
