# Retour d'expérience : refaire Dabali en 2 à 3 heures le jour du hackathon

Ce projet est une **répétition**. Le jour J, on doit tout reconstruire vite. Ce fichier liste ce qui nous a fait
perdre du temps et ce qu'il faut préparer **avant** le hackathon. À compléter à chaque répétition.

## 1. Les décisions à figer dès le départ (sinon on refait tout)

| Décision | Choix retenu | Ce que ça nous a coûté de changer en cours de route |
|---|---|---|
| Ticket lié à un plat ou générique ? | **Générique par type de repas** (petit-déj 500, déjeuner 2 500, snack 700, dîner 2 500) ; le plat se choisit **au comptoir** | Refonte complète (base, achat, scan, prévisions, tests) |
| Durée de validité | **48 h** | — |
| Supplément | entrée **ou** dessert, choisi à l'achat | — |
| Fidélité | **10 points = 1 petit-déjeuner offert** | — |
| Argent d'un ticket | revient au prestataire **au scan** ; ticket non scanné **remboursé automatiquement** à l'expiration, rappel 3 h avant | Recalcul des chiffres + remboursement rétroactif de l'historique |
| Thème | mobile, **clair**, seul l'écran QR s'inspire des maquettes | Refonte du design |

## 2. Les erreurs à ne pas refaire

1. **Photos des plats** : chercher des photos au fil de l'eau (Wikimedia, puis Pexels…) a pris beaucoup de temps,
   et des services (petit-déjeuner, snack) se sont retrouvés sans image.
   → **Toutes les photos sont maintenant dans le dépôt** (`public/dishes/*.jpg`) et le seed les référence.
   Wikimedia bloque vite les téléchargements en série (erreur 429) : ne pas compter dessus le jour J.
   **Toujours optimiser** une nouvelle photo : `python scripts/optimize-photos.py public/dishes/xxx.jpg`
   (4:3, 720×540, < 100 Ko). Les 17 photos sont passées de 2,3 Mo à 0,9 Mo.
   Pour un nouveau plat : ajouter la photo dans `public/dishes/` **en même temps** que le plat.
2. **Hébergement Netlify** : le déploiement automatique depuis l'outil a été refusé ; il a fallu passer par l'interface.
   → Préparer le site Netlify à l'avance (lié au dépôt GitHub, variables d'environnement remplies).
3. **Secrets Supabase** : le stockage des secrets des fonctions était « en pause ».
   → La clé QR est dérivée de la clé service_role ; la clé Anthropic est dans **Supabase Vault**. Prévoir les deux
   solutions dès le début.
4. **Réglages Supabase oubliés** : désactiver « Confirm email » et mettre l'URL du site (Site URL) dès la création.
5. **Écraser le dossier `.git`** en copiant le squelette Next.js : créer le squelette **dans un dossier vide à part**.
6. **Tests après la refonte** : 7 fichiers de tests à réécrire. → Écrire les tests sur le modèle **final** (section 1).
7. **Numéros de migration** : les fichiers locaux doivent porter le même numéro que dans Supabase (renommage
   systématique après chaque `apply_migration`).
8. **Arrondis d'affichage** : `to_char(x, 'FM999990.##')` arrondissait à l'unité (« 10 kg » au lieu de 9,8).
   → Utiliser la fonction `public._num()`.

## 3. Ordre de construction le jour J (cible : 2-3 h)

1. Créer le projet Supabase, le site Netlify (lié au dépôt GitHub) et le jeton Supabase (10 min).
2. Remplir `scripts/install.env` (copie de `scripts/install.env.example`) puis **une seule commande** :
   ```bash
   bash scripts/install.sh
   ```
   Elle applique les migrations dans l'ordre (une seule fois chacune), charge les données de démo (comptes,
   plats **avec photos**, menus, historique), range la clé Anthropic dans Vault, déploie les 4 Edge Functions
   et vérifie que les soldes sont justes. Relançable sans risque.
   Test sans Supabase : `bash scripts/install.sh --local` (Postgres local).
3. Les 3 réglages affichés à la fin du script (Confirm email, Site URL, variables Netlify) (5 min).
4. Lancer `supabase/tests/run.sh` et `scripts/e2e-deployed.js` (10 min).
5. Répéter la démo (section 4).

## 4. Le scénario de démo (à répéter)

1. Étudiant : achète 2 tickets Déjeuner avec dessert, ouvre le QR (même en mode avion).
2. Agent : scanne, choisit le plat ; 2ᵉ scan refusé ; QR falsifié refusé ; l'étudiant voit « Bon appétit ! ».
3. Admin : « Encaissé · repas servis » augmente au scan ; rupture d'un plat → grisé chez l'étudiant en < 3 s.
4. Chef : Prévisions (popularité des plats + brief de l'assistant IA), Courses (fiche auto, envoi à l'agent,
   rangement par rayon par l'IA).
5. (Si lancé) Caméra : la file d'attente et le temps d'attente en direct.

## 4 bis. Double authentification

Désactivée dans les données de démo (seed) pour que les boutons « Admin » et « Caisse » restent utilisables en
présentation. En production : Admin → Paramètres → cocher Admin et Caisse (une application type Google Authenticator
est alors demandée à la première connexion).

## 5. Ce qui manque encore (à faire avant le jour J)

- [x] Script unique « tout installer » : `scripts/install.sh`.
- [ ] Désactiver « Confirm email » et régler la Site URL dans Supabase.
- [ ] Changer la clé Anthropic (elle a été collée dans une conversation).
