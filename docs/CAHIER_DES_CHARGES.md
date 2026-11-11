# Dabali : cahier des charges complet (reproduction à l'identique)

> **But de ce document** : permettre à un autre développeur de refaire **exactement** l'application en ligne sur
> <https://dabalix.netlify.app> : mêmes écrans, mêmes règles, mêmes couleurs, mêmes animations, mêmes sons,
> même base de données, mêmes automatisations.
>
> **Règle d'or** : en cas de doute, **le dépôt fait foi** (`github.com/Bryan-Taffo-Stephen-Yves/dabali`, branche
> `main`). Ce document dit *quoi* et *pourquoi* ; chaque section indique *où* regarder dans le code.
> Rien ne doit être « amélioré » ou « simplifié » pendant la reproduction : on refait d'abord à l'identique.
>
> Documents liés : `docs/RETEX.md` (pièges rencontrés, ordre de construction), `docs/ARCHITECTURE.md`,
> `README.md` (installation, comptes de démo), `docs/projets/camera-file-attente/README.md` (projet en attente).

---

## Sommaire

1. [Le produit en bref](#1-le-produit-en-bref)
2. [Stack technique (versions exactes)](#2-stack-technique-versions-exactes)
3. [Organisation du dépôt](#3-organisation-du-dépôt)
4. [Design : couleurs, typographie, composants](#4-design--couleurs-typographie-composants)
5. [Animations, sons, vibrations, bitmojis](#5-animations-sons-vibrations-bitmojis)
6. [Règles métier (décisions figées)](#6-règles-métier-décisions-figées)
7. [Rôles et accès](#7-rôles-et-accès)
8. [Écrans, un par un](#8-écrans-un-par-un)
9. [Workflows de bout en bout](#9-workflows-de-bout-en-bout)
10. [Base de données](#10-base-de-données)
11. [Fonctions serveur (Edge Functions) et IA](#11-fonctions-serveur-edge-functions-et-ia)
12. [Notifications (dans l'appli et push)](#12-notifications-dans-lappli-et-push)
13. [Appli installable et mode hors ligne](#13-appli-installable-pwa-et-mode-hors-ligne)
14. [Sécurité](#14-sécurité)
15. [Données de démo](#15-données-de-démo)
16. [Installation et déploiement](#16-installation-et-déploiement)
17. [Tests](#17-tests)
18. [Critères d'acceptation (« identique »)](#18-critères-dacceptation--identique-)
19. [Hors périmètre / en attente](#19-hors-périmètre--en-attente)
20. [À construire le jour du concours : approvisionnement automatique](#20-à-construire-le-jour-du-concours--approvisionnement-automatique)

---

## 1. Le produit en bref

**Dabali** (« manger » en dioula) est la cantine connectée d'une école hôtelière à **Abidjan**.

- Les étudiants **rechargent** un solde prépayé, **achètent des tickets** par type de repas, et présentent un
  **QR** au comptoir. Le **plat se choisit au comptoir**.
- Les **agents** scannent les QR (ou valident sans téléphone avec le code PIN du client) et enregistrent le plat servi.
- La **caisse**, le **chef** et l'**administrateur** pilotent : caisse, menus de la semaine, plats, stock, courses,
  prévisions (avec assistant IA), ventes, gaspillage, avis, affluence, équipe, paramètres.

| Élément | Valeur |
|---|---|
| Langue de l'interface | **Français** uniquement (tutoiement côté client, ton simple) |
| Monnaie | **FCFA**, entiers, espace insécable comme séparateur : `21 500 FCFA` |
| Fuseau horaire | **Africa/Abidjan** (UTC+0) partout (dates, heures, fins de service) |
| Cible principale | **Téléphone** (largeur 390 à 412 px). L'admin est aussi pensé pour ordinateur (1366 px). |
| Thème | **Clair** partout ; seul le **scanner** de l'agent est sombre (`bg-ink`) |
| Adresse en ligne | <https://dabalix.netlify.app> |
| Projet Supabase actuel | `punghxwtknejxkedaoty` |

Trois espaces :

| Espace | Adresse | Pour qui |
|---|---|---|
| Appli client | `/app/*` | tout le monde (rôle client et personnel) |
| Scanner | `/scan`, `/scan/historique` | agent, admin |
| Tableau de bord | `/admin/*` | caisse, chef, admin (pages filtrées par rôle) |
| Courses (employé au magasin) | `/courses` | agent, caisse, chef, admin |

---

## 2. Stack technique (versions exactes)

| Brique | Version / choix |
|---|---|
| Framework | **Next.js 15.5.29** (App Router, `src/app`), **React 19.1.0**, **TypeScript 5** |
| Styles | **Tailwind CSS v4** (`@tailwindcss/postcss`), jetons dans `@theme` (fichier `src/app/globals.css`) |
| Police | **Plus Jakarta Sans Variable** via `@fontsource-variable/plus-jakarta-sans` ^5.3.0 (pas de Google Fonts) |
| Icônes | **lucide-react** ^1.70.0 |
| Utilitaire classes | `clsx` ^2.1.1 |
| Backend | **Supabase** : Postgres géré, Auth (e-mail + mot de passe, TOTP), Storage, Realtime, Edge Functions (Deno), pg_cron, pg_net, Vault |
| Client Supabase | `@supabase/supabase-js` ^2.119.0, `@supabase/ssr` ^0.12.7 (session en cookies partagée avec le middleware) |
| QR (affichage) | `qrcode` ^1.5.4 (SVG noir sur blanc, marge 1, correction M) |
| QR (lecture caméra) | `@zxing/browser` ^0.2.1 + `@zxing/library` ^0.23.0 |
| IA | **Claude** via `npm:@anthropic-ai/sdk` dans les Edge Functions, modèle **`claude-opus-5-5`**, repli serveur (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`), sortie JSON structurée (`output_config.format = json_schema`) |
| Notifications push | Web Push VAPID, `npm:web-push@3.6.7` dans l'Edge Function `send-push` |
| Hébergement front | **Netlify** (Node 22, `@netlify/plugin-nextjs`, publication auto depuis `main`) |
| Vision (affluence) | Python + YOLO (`vision/`), **non lancé** (voir §19) |
| Aucune autre dépendance | pas de librairie d'UI, de graphiques, d'animation ou de confettis : tout est fait à la main |

`netlify.toml` : build `npm run build`, publish `.next`, `NODE_VERSION=22`, en-têtes :
`/sw.js` → `Cache-Control: no-cache` + `Service-Worker-Allowed: /` ;
`/dishes/*` → `Cache-Control: public, max-age=604800, stale-while-revalidate=86400`.

---

## 3. Organisation du dépôt

```
src/
  app/
    (auth)/connexion, inscription, double-authentification, layout.tsx   ← écrans sans barre
    app/            ← appli client (layout + template d'animation + error.tsx)
      page.tsx (accueil), menu/, menu/[id]/, acheter/, tickets/, tickets/[id]/, historique/,
      profil/, recharger/, transferer/, notifications/, avis/[id]/
    scan/           ← scanner agent + historique
    admin/          ← tableau de bord (layout = AdminShell)
    courses/        ← fiche de courses de l'employé
    manifest.ts     ← manifeste PWA
    layout.tsx      ← police, ToastProvider, enregistrement du service worker
  components/
    ui/ (button, field, sheet, toast, pin-pad)   app/ (…)   admin/ (shell, ui, charts, forecast-brief)
    scan/no-phone-sheet.tsx   bitmoji.tsx   qr.tsx   logo.tsx   push-toggle.tsx   install-app.tsx   register-sw.tsx
  lib/  (supabase/client.ts, types.ts, format.ts, menu.ts, tickets.ts, offline.ts, push.ts, reviews.ts,
         shopping.ts, roles.ts, scan-sounds.ts, confetti.ts, bitmoji.ts, config.ts)
  middleware.ts
public/  sw.js, icons/ (192, 512, maskable-512, apple-touch-icon), dishes/*.jpg (17 photos)
supabase/
  migrations/  (32 fichiers, nommés avec la version distante)   seed.sql   data/*.sql
  functions/   ticket-token, redeem-ticket, forecast-assistant, shopping-organize, menu-assistant, send-push, _shared/
  tests/       00_local_stubs, 01_helpers, 10…98_*.sql, qr.test.ts, concurrency.sh, run.sh
scripts/  install.sh, install.env.example, optimize-photos.py, e2e-deployed.js
vision/   occupancy.py, calibrate.py (+ tests)
docs/     CAHIER_DES_CHARGES.md (ce fichier), RETEX.md, ARCHITECTURE.md, projets/
```

Conventions de code : composants client (`"use client"`), commentaires en français, aucune logique d'argent
côté navigateur (tout passe par des fonctions SQL `SECURITY DEFINER` qui renvoient `{ ok, code, message, … }`).

---

## 4. Design : couleurs, typographie, composants

### 4.1 Couleurs (jetons Tailwind, `src/app/globals.css`)

| Jeton | Hex | Usage |
|---|---|---|
| `lime` | `#C8F135` | couleur de marque : bouton principal, carte solde, onglet central, accents sur fond sombre |
| `lime-soft` | `#EEFBC4` | fonds doux (fidélité, badges, recharges) |
| `lime-deep` | `#66850A` | **texte** vert sur blanc (contraste ≈ 4,5:1), barres de progression |
| `ink` | `#16181D` | texte principal, boutons sombres, scanner, barre de sélection |
| `ink-2` | `#3A3F4B` | texte secondaire fort |
| `muted` | `#5B6270` | textes secondaires (lisibles au soleil) |
| `off` | `#858B97` | icônes inactives, chevrons, placeholders |
| `line` | `#E7E9EE` | bordures, séparateurs |
| `canvas` | `#F6F7F9` | fond de page (aussi `theme-color` et fond du manifeste) |
| `card` | `#FFFFFF` | cartes |
| `ok` / `ok-soft` | `#22C55E` / `#DCFCE7` | succès (texte vert foncé : `#15803D`) |
| `err` / `err-soft` | `#EF4444` / `#FEE2E2` | erreurs, refus, déconnexion |
| `warn` / `warn-soft` | `#F59E0B` / `#FEF3C7` | avertissements (texte : `#92400E`), étoiles |

Couleurs complémentaires codées en dur (à reprendre telles quelles) :

- **Par type de repas** (`SERVICE_TONE`, `components/app/service-icon.tsx`) : petit-déjeuner `#FEF3C7`/`#92400E`
  (icône `Coffee`), déjeuner `lime-soft`/`#4D6B05` (`Sun`), snack `#FCE7F3`/`#9D174D` (`Cookie`),
  dîner `#E0E7FF`/`#3730A3` (`Moon`).
- **Historique client** : vert = argent qui entre (`ok-soft` / `#15803D`), **bleu = transferts envoyés**
  (`#E0EBFF` / `#1D4ED8`), gris = repas achetés (`canvas` / `ink`), recharges `lime-soft`/`lime-deep`.
- **Affluence** : calme `#22C55E`, animé `#F59E0B`, très plein `#EF4444`.
- **Opérateurs Mobile Money** (recharge) : Wave `#1DC3FF`, Orange Money `#FF7900`, MTN MoMo `#FFCB05`, Moov Money `#0066B3`.
- **Statut de ticket** (`STATUS_META`, `lib/tickets.ts`) : Valide (pastille `ok`, puce `ok-soft`/`#15803D`),
  Expiré (`err`), Utilisé (`off`, puce `canvas`/`muted`), Annulé (`ink`, puce `ink`/blanc).
- Badge « sans QR » (admin) : fond `#FEF3C7`, texte `#92400E`.

### 4.2 Typographie, rayons, ombres

- Police : `"Plus Jakarta Sans Variable", ui-sans-serif, system-ui, sans-serif` ; `font-feature-settings: "tnum" 1`
  (chiffres à chasse fixe partout) ; `-webkit-font-smoothing: antialiased`.
- Graisses : titres `font-extrabold` (800) avec `tracking-tight` ; libellés `font-bold` ; texte courant `font-semibold`/`medium`.
- Tailles repères : titre de page client 26 px, salutation 22 px, solde 40 px, titres de section 17 px,
  texte de base 15 px, petites légendes 11 à 13 px. Champs de saisie en **16 px** (évite le zoom iOS).
- Rayons : cartes `rounded-[22px]` à `rounded-[28px]` ; boutons et puces `rounded-full` ; tuiles `rounded-2xl`.
- Ombres : `--shadow-card: 0 1px 2px rgb(22 24 29 / .04), 0 4px 16px rgb(22 24 29 / .06)` ;
  `--shadow-float: 0 8px 24px rgb(22 24 29 / .14)` (barre du bas, toasts, menus flottants).
- `html { -webkit-tap-highlight-color: transparent }` ; `.no-overscroll { overscroll-behavior: none }` sur le
  scanner et l'écran du QR.

### 4.3 Mise en page

- **Appli client** : colonne centrée `max-w-md`, marges 16 px (`px-4`), en-têtes avec
  `pt-[max(1rem,env(safe-area-inset-top))]` (encoche), bas de page `pb-32` pour la barre flottante.
- **Barre du bas** (`components/app/bottom-nav.tsx`) : flottante, `rounded-[26px]`, `bg-card/95` + flou,
  bordure `line`, ombre `float`. 5 onglets : Accueil (`Home`), Menu (`UtensilsCrossed`), **Mon QR** au centre
  (`QrCode`, carré 60 px `rounded-[22px]` qui dépasse de 28 px vers le haut, `bg-lime` avec ombre verte ;
  `bg-ink text-lime` quand actif, anneau 5 px couleur `canvas`), Historique (`ReceiptText`), Profil (`UserRound`).
  Onglet actif : icône `ink` épaissie + point `lime-deep` dessous. **Cachée** sur `/app/menu/[id]`,
  `/app/recharger`, `/app/transferer`, `/app/acheter` (ces écrans ont leur propre bouton en bas).
- **Admin** : barre latérale fixe 256 px (`w-64`) sur ordinateur (≥ `lg`), en-tête + puces défilantes sur
  téléphone ; contenu `max-w-[1200px]`. Toutes les cartes ont `min-w-0` (sinon débordement sur téléphone).
- **Scanner** : plein écran sombre (`fixed inset-0 bg-ink text-white`), vidéo dans un cadre `rounded-[28px]`.

### 4.4 Composants de base

| Composant | Fichier | Détails exacts |
|---|---|---|
| `Button` / `ButtonLink` | `ui/button.tsx` | `rounded-full font-bold`, variantes : **primary** `bg-lime text-ink`, **dark** `bg-ink text-white`, **ghost**, **outline** (`border-line bg-card`), **danger** (`bg-err-soft text-err`). Tailles : sm `h-9`, md `h-11 text-[15px]`, lg `h-14 text-base`. `loading` = icône `Loader2` qui tourne. Désactivé : opacité 45 %. |
| `Field` | `ui/field.tsx` | libellé 13 px `ink-2` gras ; champ `h-13 rounded-2xl border-line bg-card px-4 text-[16px]` ; focus : bordure `ink` + halo `ring-4 ring-lime/40` ; erreur : bordure `err` + texte rouge dessous. |
| `Sheet` | `ui/sheet.tsx` | panneau qui monte du bas : fond `bg-ink/40` + flou 2 px, panneau `rounded-t-[28px] bg-card max-h-[92dvh]`, poignée 40×6 px, titre 18 px + bouton fermer rond, `Échap` ferme, bloque le défilement de la page, animation `animate-rise`. |
| `Toast` | `ui/toast.tsx` | en haut, centré `max-w-md`, `rounded-2xl`, **succès = fond `ink` + icône `CheckCircle2` lime**, **erreur = fond `err`** ; disparaît après **3,8 s** ; `animate-rise`. |
| `PinPad` | `ui/pin-pad.tsx` | 4 ronds (16 px) qui se remplissent en `ink`, clavier 3×4 de touches `h-16 rounded-2xl bg-canvas text-2xl` (1–9, vide, 0, effacer `Delete`), secousse à l'erreur, **un seul envoi par code saisi** (référence vers la dernière fonction, pas de double envoi). |
| `Logo` | `components/logo.tsx` | carré 40×40 `rx=12` `#16181D`, bol `#C8F135` + 3 volutes de vapeur, mot « dabali » 22 px extra-gras ; variante `mark` (icône seule). |
| `ServiceIcon` / `ServiceBadge` | `app/service-icon.tsx` | icône lucide par service, pastille `rounded-2xl` aux couleurs `SERVICE_TONE`. |
| `DishImage` | `app/dish-image.tsx` | photo du plat ; **repli** (pas de photo ou erreur) : dégradé + initiales du plat. |
| `Qr` | `components/qr.tsx` | SVG via `qrcode`, toujours noir `#000` sur blanc, marge 1, niveau M ; squelette gris tant que vide. |
| `Bitmoji` | `components/bitmoji.tsx` | voir §5.4. |
| `PageHeader` | `app/page-header.tsx` | titre de page + bouton retour rond optionnel. |
| Cartes admin | `admin/ui.tsx` | `Card` (titre, sous-titre, actions qui passent à la ligne, `min-w-0`), `Kpi` (tons `dark` / `lime` / blanc), `PageTitle`. |
| Graphiques admin | `admin/charts.tsx` | SVG faits main, une seule série, barres fines aux bouts arrondis côté donnée, grille discrète, info-bulle au survol, heure courante en vert, largeur mesurée (texte des axes à taille constante). |

---

## 5. Animations, sons, vibrations, bitmojis

### 5.1 Animations CSS (toutes dans `globals.css`, désactivées si `prefers-reduced-motion: reduce`)

| Classe | Keyframes | Durée / courbe | Où |
|---|---|---|---|
| `animate-pop` | 0 % `scale(.85) opacity 0` → 60 % `scale(1.04) opacity 1` → 100 % `scale(1)` | 0,35 s ease-out, `both` | coches de succès, bitmojis, ronds de fidélité (décalés de 40 ms chacun), photos de la connexion (70 ms) |
| `animate-rise` | `translateY(12px) opacity 0` → `translateY(0) opacity 1` | 0,3 s ease-out, `both` | toasts, panneaux `Sheet`, menu « ⋯ » admin, texte « C'est acheté ! » (délai 0,9 s) |
| `animate-page` | `translateY(8px) opacity 0` → `transform: none; opacity 1` | 0,28 s `cubic-bezier(.2,.8,.2,1)`, **`backwards`** | chaque changement d'écran de l'appli client (`src/app/app/template.tsx`) |
| `animate-nav` | 0 % → 35 % `translateY(-5px) scale(1.15)` → 65 % `translateY(1px) scale(.96)` → 100 % repos | 0,45 s ease-out | icône de l'onglet actif (rejouée à chaque changement d'onglet via `key`) |
| `animate-print` | `translateY(-105%)` → 70 % `translateY(4%)` → `translateY(0)` | 1 s `cubic-bezier(.3,.9,.3,1)`, délai 0,15 s | ticket qui « sort de l'imprimante » après un achat |
| `qr-live` | propriété `@property --qr-angle` 0 → 360° sur un `conic-gradient(#c8f135, #16181d 25%, #c8f135 50%, #16181d 75%, #c8f135)` | 3,5 s linéaire, infini | cadre de 4 px autour du QR d'un ticket valide |
| `animate-pulse` / `animate-spin` / `animate-ping` | Tailwind | | squelettes de chargement, boutons en cours, point « en direct » |

> ⚠️ **`animate-page` doit être en `backwards`**, jamais `both`/`forwards` : sinon Chrome laisse un
> `translateY(0)` sur la page, ce qui casse tous les éléments `position: fixed` (panneaux, barres du bas).

Autres effets :

- **Confettis** (`lib/confetti.ts`, canevas plein écran sans librairie) : 130 confettis partant du milieu-haut,
  couleurs `#C8F135 #16181D #F59E0B #22C55E #FFFFFF`, gravité 0,35, 1,8 s, fondu sur les 30 derniers %.
  Déclenché **une fois par petit-déjeuner gagné** (passage d'un multiple de 10 points), jamais au premier
  affichage sur un nouvel appareil (clé locale `dabali:rewards:<id>`).
- **QR vivant** : sous le QR, **heure à la seconde** (police mono, point vert qui pulse) : une capture d'écran se repère.
- **Écran allumé** pendant l'affichage du QR (`navigator.wakeLock.request("screen")`).

### 5.2 Sons du scanner (`lib/scan-sounds.ts`, Web Audio, aucun fichier son)

| Événement | Notes | Vibration |
|---|---|---|
| Ticket valide | carillon montant **1046 → 1318 → 1568 Hz** (sinus, à 0 / 0,09 / 0,18 s, durées 0,14 / 0,14 / 0,32 s, volume 0,28) | 70 ms |
| Refus | double bourdonnement **196 puis 165 Hz** (carré, volume 0,18, 0,2 s puis 0,32 s à 0,24 s) | 140-70-140 ms |
| Plat enregistré | « clic » **1760 Hz** triangle 0,06 s (volume 0,2) | 30 ms |
| Voix | synthèse vocale `fr-FR`, débit 1,08 : « Aya. Déjeuner valide. Avec Salade de fruits. » / « Ticket déjà utilisé »… | |

Bouton à 3 états dans l'en-tête du scanner : **Sons + voix** (`Volume2`) → **Sons seuls** (`Volume1`) → **Muet**
(`VolumeX`), mémorisé sur l'appareil.

### 5.3 Vibrations côté client

Achat réussi `[20, 60, 40]` ; ticket scanné (vu par l'étudiant) 120 ms ; confettis `[30, 50, 30, 50, 60]` ;
avis envoyé 60 ms. (iPhone ignore les vibrations web : normal.)

### 5.4 Bitmojis (`lib/bitmoji.ts` + `components/bitmoji.tsx`)

Personnages africains **originaux dessinés en SVG** (aucune image externe), cercle 120×120, contenu zoomé ×1,13.

12 personnages (identifiant → description) :

| id | Nom | Peau | Coiffure | Tenue (couleur / motif) | Accessoires | Fond |
|---|---|---|---|---|---|---|
| `aya` | Aya | `#8D5524` | foulard vert `#16A34A`, nœud et bandeau jaune `#FACC15` | orange `#F97316` à pois `#FDE68A` | boucles d'oreilles | `#FEF3C7` |
| `koffi` | Koffi | `#5A3420` | dégradé court | bleu `#1D4ED8` zigzag `#93C5FD` | barbe | `#DBEAFE` |
| `awa` | Awa | `#A0662F` | tresses (perles) | vert `#65A30D` à pois `#D9F99D` | boucles | `#ECFCCB` |
| `yao` | Yao | `#6B3E26` | kufi kente rouge `#B91C1C` / jaune | sarcelle `#0F766E` rayé `#99F6E4` | | `#CCFBF1` |
| `fatou` | Fatou | `#4A2A1A` | bantu knots | rose `#DB2777` à pois `#FBCFE8` | boucles | `#FCE7F3` |
| `ibrahim` | Ibrahim | `#8D5524` | dégradé | noir `#16181D` rayé lime | lunettes | `#EEFBC4` |
| `adjoua` | Adjoua | `#6B3E26` | afro | jaune `#EAB308` zigzag `#7C2D12` | boucles | `#FEF9C3` |
| `moussa` | Moussa | `#5A3420` | locks | orange `#EA580C` kente `#15803D` | barbe | `#FFEDD5` |
| `mariam` | Mariam | `#C68642` | foulard violet `#7C3AED` / ambre | violet zigzag `#DDD6FE` | | `#EDE9FE` |
| `kouame` | Kouamé | `#4A2A1A` | crâne rasé (reflet) | vert `#15803D` kente `#FACC15` | barbe + lunettes | `#DCFCE7` |
| `aminata` | Aminata | `#A0662F` | chignon (puff) | cyan `#0891B2` à pois `#CFFAFE` | boucles | `#CFFAFE` |
| `sekou` | Sékou | `#8D5524` | twists | rouge `#DC2626` zigzag `#FECACA` | | `#FEE2E2` |

7 expressions : **happy** (sourire avec dents), **laugh** (yeux fermés, bouche ouverte, langue), **yum** (yeux
fermés, langue sur le côté), **wow** (grands yeux, bouche en O, étincelle jaune), **wink** (clin d'œil),
**sad** (sourcils inclinés, larme bleue), **sleep** (yeux fermés, « z z » blancs contourés).

Règles :
- Choix dans **Profil** (toucher le bitmoji, badge « Changer ») → panneau « Choisis ton bitmoji » (grille 3 colonnes,
  sélection sur fond `ink`, expression « laugh »), enregistré dans `profiles.avatar`.
- Sans choix : **bitmoji fixe calculé** depuis l'identifiant du compte (`hash × 31 mod 12`).
- Où il apparaît : accueil (48 px, rit si un petit-déjeuner offert est disponible), profil (96 px, anneau lime),
  « Aucun ticket valide » (yum), achat réussi (wow ; wink pour un cadeau), « Bon appétit ! » (yum, 144 px),
  écran d'erreur / hors ligne (sad), **scanner de l'agent** (laugh, 80 px, à côté de la coche),
  recherche « Sans téléphone » (44 px ; wink à l'étape PIN).

---

## 6. Règles métier (décisions figées)

> Ces choix ont coûté cher à changer en cours de route (voir `RETEX.md`) : ne pas les rediscuter.

| Règle | Valeur |
|---|---|
| Ticket | **générique par type de repas** (pas lié à un plat). Le plat se choisit **au comptoir**. |
| Types de repas et prix | **Petit-déjeuner** 06h30–09h30, **500 F** · **Déjeuner** 11h30–14h30, **2 500 F** · **Snack** 15h30–17h00, **700 F** · **Dîner** 17h30–20h00, **2 500 F** (réglage `services`) |
| Suppléments | **au plus une entrée et un dessert** par ticket (chacun facultatif), choisis à l'achat, **seulement au déjeuner et au dîner** (desserts de 200 à 500 F, entrées 500 F) ; refus « Choisissez au plus une entrée et un dessert. » |
| Validité | **48 h** après l'achat (`ticket_validity_hours`) |
| Achat | 1 à **10 tickets** par achat ; impossible pour un service déjà terminé |
| Argent | va au prestataire **au moment du scan** (« Encaissé · repas servis »), pas à l'achat |
| Ticket non utilisé | **remboursé automatiquement** à l'expiration (tâche toutes les 5 min) + **rappel 3 h avant** |
| Annulation | possible par le client jusqu'à **60 min** avant la fin de validité (`cancel_cutoff_minutes`), remboursement immédiat |
| Fidélité | **1 repas servi = 1 point** ; **10 points = 1 petit-déjeuner offert** (option à l'achat) |
| Code PIN | 4 chiffres, créé à l'inscription ; interdits : 4 chiffres identiques, 1234, 4321, 0123, 9876 ; **exigé au-delà de 5 000 F**, pour **tout cadeau** et **tout transfert** ; **3 erreurs = blocage 15 min** |
| Recharge | 100 à 500 000 F (`recharge_limits`) ; Mobile Money **simulé** (Wave, Orange, MTN, Moov) ; espèces à la caisse |
| Transfert | 100 à 50 000 F par envoi, **100 000 F par jour** (`transfer_limits`) |
| Identifiant court | `DB-` + 4 à 6 chiffres (ex. `DB-2026`), unique, sert aux transferts et au retrait sans téléphone |
| Jours de service | **lundi → samedi** (`service_days = [1..6]`) ; prévente sur **7 jours** |
| Menu de la semaine | le chef le prépare, le **soumet avant le mercredi 23h59** (`menu_deadline`), l'admin le **publie** |
| Avis | demandé **30 min après le repas** ; 1 avis par repas ; plaintes en un clic ; photo facultative |
| Alerte solde bas | sous **2 000 F** (`low_balance_threshold`) |
| Double authentification | possible pour le personnel ; **désactivée en démo** (`mfa_required_roles = []`) |

---

## 7. Rôles et accès

Rôles (`user_role`) : `client`, `agent`, `caissier`, `chef`, `admin`.

- **Page d'arrivée** après connexion (`lib/roles.ts`) : agent → `/scan` ; caissier, chef, admin → `/admin` ; client → `/app`.
- **Middleware** (`src/middleware.ts`) : sans session → `/connexion` ; espace interdit → redirection vers la
  page d'arrivée du rôle ; personnel sans niveau `aal2` alors que la double authentification est exigée →
  `/double-authentification?next=…`. **La vraie sécurité reste la base (RLS + fonctions).**

| Espace | Rôles |
|---|---|
| `/app` | tous |
| `/scan` | agent, admin |
| `/admin` | caissier, chef, admin |
| `/courses` | agent, caissier, chef, admin |

Menu de l'admin (`components/admin/admin-shell.tsx`) et rôles autorisés :

| Page | Icône | Rôles |
|---|---|---|
| Vue d'ensemble `/admin` | `LayoutDashboard` | caissier, chef, admin |
| Caisse | `Wallet` | caissier, admin |
| Menu hebdo | `CalendarDays` | chef, admin |
| Plats | `UtensilsCrossed` | chef, admin |
| Prévisions | `TrendingUp` | chef, admin |
| Stock | `Boxes` | chef, admin |
| Courses | `ShoppingCart` | chef, admin |
| Ventes | `BarChart3` | caissier, chef, admin |
| Scans | `ScanLine` | caissier, chef, admin |
| Gaspillage | `Trash2` | chef, admin |
| Avis | `Star` | chef, admin |
| Affluence | `Users` | caissier, chef, admin |
| Équipe | `UserCog` | admin |
| Paramètres | `Settings` | admin |

- Page ouverte par son adresse sans le bon rôle → carte **« Page réservée »** (icône bouclier, bouton « Retour à la
  vue d'ensemble »). **Aucune page n'est montée tant que le profil n'est pas chargé** (squelette), pour éviter des
  appels refusés.
- Bas de la barre latérale : **un seul bloc profil** (initiales sur rond lime, nom, rôle, bouton `⋯`) qui ouvre un
  menu : Scanner (agent/admin), Appli client, Installer l'appli, Notifications, Double authentification, Déconnexion (rouge).

---

## 8. Écrans, un par un

### 8.1 Authentification (`src/app/(auth)`, colonne `max-w-md`, logo + pastille « Cantine connectée »)

**Connexion** `/connexion`
- Titre 34 px « Mangez sans **attendre.** » (mot souligné par un surligneur lime de 12 px).
- Sous-titre : « Rechargez, réservez votre plat, présentez votre QR. C'est tout. »
- 4 photos de plats rondes qui se chevauchent (attiéké, alloco, garba, poulet frites ; apparition en cascade) +
  « Solde prépayé · menu en photos / ticket QR, même hors ligne » (ce ne sont **pas** des boutons).
- Champs E-mail, Mot de passe, bouton lime « Se connecter », lien « Créer un compte ».
- Bas de page : « COMPTES DE DÉMO » + puces **Client, Agent, Chef, Caisse, Admin** (connexion en un clic,
  mot de passe `Dabali2026!`).

**Inscription** `/inscription` : Nom complet, Téléphone, E-mail, Mot de passe (8 caractères min.) → étape
**« Créez votre code PIN »** (PinPad « 4 chiffres ») → **« Confirmez votre code »** → arrivée dans l'appli.

**Double authentification** `/double-authentification` : intro (« Commencer » / « Plus tard ») → QR à scanner
avec Google Authenticator / Microsoft Authenticator / Authy + clé manuelle → code à 6 chiffres → « activée » ;
ensuite code demandé à chaque connexion ; « Changer de téléphone » réinitialise. Aucun enrôlement automatique.

### 8.2 Appli client (`/app`)

En haut de chaque écran, si plus de réseau : bandeau noir **« Hors ligne · vos QR marchent, achats et transferts au
retour du réseau »** (icône `WifiOff` lime).

**Accueil** `/app`
1. En-tête : bitmoji (lien vers Profil), date longue (« Lundi 9 novembre »), « Bonjour Aya », cloche avec pastille
   rouge du nombre de notifications non lues (9+).
2. **Carte solde** lime `rounded-[28px]` : « Solde disponible », identifiant `DB-…` en puce, montant 40 px,
   anneau décoratif blanc à 30 %, 3 tuiles noires : **Recharger** (`Plus`), **Transférer** (`Send`), **Acheter**
   (`UtensilsCrossed`) avec icônes lime.
3. Carte « Installer l'appli » (si pas encore installée).
4. **Fidélité** : « 7 / 10 points » ou « Petit-déjeuner offert disponible 🎉 » (× n si ≥ 20), barre de progression,
   « + 9 / 10 vers le suivant ».
5. **Mes tickets** (« Tout voir ») : **uniquement les tickets valides**, le plus proche de l'expiration d'abord ;
   sinon carte pointillée « Aucun ticket valide · Achetez vos tickets, évitez la file » + bouton « Acheter ».
6. **Prochain service** (« Demain · Petit-déjeuner », lien « Menu ») : bandeau noir « Votre plat préféré est au
   menu : … » (plat le plus servi, au moins 2 fois), puis vignettes photo défilantes (144 px).
7. **Affluence** : anneau coloré + « Calme / Animé / Très plein », attente estimée ; ou « Réfectoire fermé ·
   Déjeuner demain à partir de 11h30 » ; ou « Affluence indisponible pour le moment ».

**Menu** `/app/menu`
- En-tête collant : « Au menu », **8 jours** en puces (« Auj. », jours sans menu grisés), puis puces des services
  du jour (icône + nom), ligne « 06h30 – 09h30 · ticket 500 FCFA · entrée ou dessert en option », « service
  terminé » en rouge.
- Cartes plat : photo 176 px, étiquettes « Épuisé » (rouge), « Bientôt épuisé · 3 » (orange, reste ≤ max(3, 15 % du prévu)), « Populaire » (lime, note ≥ 4,2 et ≥ 40 avis), note
  étoilée « 4,6 (23) », nom 17 px, composition, kcal. **Plat épuisé = grisé** (mise à jour en direct < 3 s).
- Barre flottante noire « Ticket Petit-déjeuner · 500 FCFA » + bouton lime « Acheter › » ; la liste a assez de
  marge en bas pour que la barre ne cache rien.

**Fiche plat** `/app/menu/[id]` : photo, informations (composition, allergènes, kcal, poids), avis des clients,
bouton d'achat du ticket du service.

**Acheter** `/app/acheter`
- « Le plat se choisit au comptoir. Ticket valable 48 h pour le repas choisi. »
- Grille 2×2 des types de repas (pastille colorée, horaires, prix, case cochée `ink`).
- Nombre de tickets (– / +, 1 à 10).
- Supplément (déjeuner/dîner) : une entrée et/ou un dessert (toucher un autre article du même type le remplace).
- Interrupteur « 1 petit-déjeuner offert avec 10 points » (petit-déjeuner seulement).
- « Offrir ces tickets » → recherche du bénéficiaire (téléphone, `DB-…` ou scan de son QR de profil).
- Bouton noir en bas « 2 tickets Déjeuner · 6 000 FCFA ». PIN demandé si > 5 000 F ou cadeau.
- **Succès** : écran noir, fente d'imprimante, **ticket blanc qui descend** (`animate-print`), puis bitmoji + « C'est
  acheté ! » (ou « Cadeau envoyé ! »), vibration ; 1,7 s plus tard ouverture du QR (1 ticket) ou de la liste.

**Mes tickets** `/app/tickets` : onglets « Valides (n) » / « Historique », lignes de ticket (pastille service,
statut, validité ou plat servi), bouton « + Acheter ».

**Ticket** `/app/tickets/[id]`
- En-tête : retour, « Mon ticket », puce de statut.
- **Talon** : QR 290 px dans le **cadre vivant** (dégradé conique qui tourne), **heure à la seconde** dessous,
  « Présentez ce code au comptoir, choisissez votre plat » ; ticket utilisé/expiré : QR flouté + rond vert (coche)
  ou rouge (croix).
- Ligne pointillée avec deux encoches (comme un vrai ticket).
- Bas : pastille service + « Ticket Déjeuner », « 🎁 Offert par Koffi », suppléments, « valable encore **2 jours** »
  (texte `lime-deep` 30 px), frise **Acheté → Valide → Utilisé**.
- Carte « Solde ⇄ Points ».
- « Montez la luminosité pour un scan instantané », bouton « Annuler et me faire rembourser ».
- **Au moment du scan** (temps réel + vérification toutes les 4 s) : plein écran vert, bitmoji qui se régale +
  coche, « **Bon appétit !** », nom du plat (ou « L'agent enregistre votre plat… »), « On te demandera ton avis dans 30 min ».

**Historique** `/app/historique`
- Carte noire « Dépensé ce mois-ci », « n repas réservés ».
- Filtres Tout / Entrées / Dépenses ; regroupement par jour (« AUJOURD'HUI », « HIER », date).
- Lignes : icône colorée par type, **titre court** (« 1 × ticket Déjeuner », « Ticket · Garba », « Reçu de Koffi
  Diabaté », « Envoyé à … », « Remboursé · ticket Déjeuner non utilisé », « Recharge Mobile Money »), dessous
  « 15h38 · DB-3796 · « message » », à droite montant signé (vert si positif) + « Solde 21 000 FCFA ».
- **Transferts répétés vers la même personne le même jour regroupés** : « 5 envois à Koffi Diabaté · −4 500 FCFA »,
  touche pour déplier.
- Hors ligne : bandeau ambre « Hors ligne : dernier historique enregistré sur ce téléphone ».

**Profil** `/app/profil`
1. Carte centrée : **bitmoji 96 px** (badge « Changer »), nom, téléphone, **QR de profil visible directement**
   (`DABALI:DB-2026`, 176 px), puce noire `DB-2026` en lime, « Montrez ce QR pour recevoir un transfert ou un repas offert ».
2. Carte lime **Fidélité** : règle, gros chiffre « 19 points », 10 ronds (reste modulo 10), « 1 petit-déjeuner
   offert à utiliser dans « Acheter » · 9/10 vers le suivant ».
3. Carte « **Téléphone éteint ou oublié ?** Vous pouvez quand même manger : au comptoir, donnez votre nom ou
   votre code DB-2026, puis tapez votre code PIN sur le téléphone de l'agent. »
4. Installer l'appli · Notifications sur ce téléphone (interrupteur ; explication si iPhone < 16.4 ou pas installée).
5. Liste : Alerte places libres (interrupteur), Changer mon code PIN (« Il sert aussi à manger sans téléphone »),
   **J'ai perdu mon téléphone**, Ouvrir le scanner (agent/admin), Tableau de bord (personnel), Se déconnecter (rouge).

**Recharger** `/app/recharger` : montants 2 000 / 5 000 / 10 000 / 25 000 / 50 000 / 100 000 ou montant libre ;
opérateur (Wave, Orange Money, MTN MoMo, Moov Money, pastilles colorées) ; simulation instantanée.

**Transférer** `/app/transferer` : destinataire (téléphone, `DB-…`, scan du QR de profil ; un QR de **ticket** donne le
message « C'est le QR d'un ticket repas, pas un QR de profil… »), montant, message facultatif, PIN.

**Notifications** `/app/notifications` : liste (titre, texte, date), tout marqué lu à l'ouverture ; toucher ouvre la page liée.

**Avis** `/app/avis/[id]` : étoiles 1–5, plaintes en un clic (voir la liste ci-dessous),
commentaire, photo facultative → « Merci pour ton avis ! » ; si avis grave : « Merci. La cuisine est prévenue tout de suite. »
Plaintes (code → libellé) : `froid` Froid, `pas_cuit` Pas assez cuit, `trop_sale` Trop salé, `fade` Fade, `portion` Portion trop petite, `corps_etranger` Corps étranger, `attente` Attente trop longue.
La fenêtre « Comment était ton … ? » s'ouvre **toute seule** 30 min après le repas (`review-prompt.tsx`), avec
« Ne pas noter ».

**Écran d'erreur** (`app/error.tsx`) : bitmoji triste (+ pastille `WifiOff` si hors ligne), « Pas de connexion » /
« Cet écran n'a pas pu s'afficher », boutons « Réessayer » (noir) et « Mon QR » (lime). La barre du bas reste utilisable.

### 8.3 Agent

**Scanner** `/scan` (sombre)
- En-tête : logo, « Scanner », « Yao Kouamé · lun. 9 nov. · 10h55 » ; boutons ronds : son (3 états),
  historique (`History`), courses (`ShoppingCart`, **lime avec pastille rouge** si une fiche lui est attribuée), déconnexion.
- Puces des 4 services (le service en cours est choisi automatiquement).
- Vidéo caméra arrière, **cadre de visée** (4 coins lime de 6 px), ligne lime qui pulse, « Ticket Déjeuner · placez
  le QR dans le cadre ».
- Pied : « DÉJEUNER · SERVIS AUJOURD'HUI **42** · 180 tickets en circulation » ; bouton **« Sans téléphone »** (`PhoneOff`).
- **Validé** (plein écran vert) : bitmoji du client + coche, nom, « Ticket Déjeuner valide », encart blanc
  « SUPPLÉMENT PAYÉ · À SERVIR + Dessert : Salade de fruits » (ou « Sans supplément : plat seul »), puces « Acheté avec
  2 autres tickets », « Il lui reste 1 ticket Déjeuner », « 🎁 Offert par … », « ⭐ Ticket fidélité », « 🔑 Sans QR ·
  code PIN », « 📵 Anciens QR désactivés » ; grille des plats du service (photo, « 12 restants » / « Épuisé ») →
  toucher = plat servi (« Servi » vert 1,3 s) ; bouton « Plat non précisé ».
- **Refusé** (plein écran rouge, croix) : « Déjà utilisé le 08/11 à 12h31 par Yao Kouamé. », « Ticket expiré… »,
  « QR invalide. », « Ticket Snack : pas valable pour le déjeuner. », « C'est le QR de profil du client, pas un
  ticket… » ; retour automatique au scan après 2,8 s.
- Un même QR n'est pas relu pendant 4 s ; la caméra est en pause quand le panneau « Sans téléphone » est ouvert.

**Sans téléphone** (panneau blanc, `components/scan/no-phone-sheet.tsx`)
1. « Demandez son nom ou son code Dabali (DB-…). Ticket **Déjeuner**. » + recherche (3 caractères min., 300 ms).
2. Résultats (8 max) : bitmoji, nom, code, puce noire « 2 tickets » ou rouge « Aucun ticket Déjeuner » / « Pas de
   code PIN : QR obligatoire » / « Code PIN bloqué » (non cliquables).
3. Étape PIN : rappel du client, « Tendez le téléphone au client : **lui seul** tape son code PIN », case
   « **Téléphone perdu ou volé** », PinPad « Code PIN du client » ; « Code incorrect · 2 essais restants ».
4. Succès = même écran vert que le scan. Encart en bas : « En cas de doute sur l'identité, demandez la carte
   d'étudiant. Le client est prévenu à chaque repas validé sans QR. »

**Historique des scans** `/scan/historique` (sombre) : Aujourd'hui / Hier, Moi / Équipe, puces par service avec
compte, lignes : heure lime, client + code, service, plat (ou « plat non précisé »), puces « + Dessert »,
« sans supplément », « 🎁 », « ⭐ fidélité », « 🔑 sans QR », « par Agent X » ; temps réel.

**Courses** `/courses` : une seule fiche attribuée, articles **rangés par rayon** (IA), on coche « acheté » / « manquant »,
quantité achetée, prix payé, « Terminer » (dépense totale) → le stock est crédité automatiquement.

### 8.4 Tableau de bord (`/admin`)

| Page | Contenu |
|---|---|
| **Vue d'ensemble** | « Bonjour Bryan », « Mis à jour à 22h31 » + rafraîchir ; 4 indicateurs : **Encaissé · repas servis** (noir ; dessous « 14 300 FCFA remboursés (non utilisés) · 479 900 FCFA en attente de scan »), **Recharges encaissées** (lime ; « dont … en espèces »), **Repas servis aujourd'hui**, **Occupation** ; graphique Ventes/Scans par heure (heure actuelle en vert) ; Alertes ; Services du jour (servis vs prévus) ; Top 5 des plats (7 jours, photos) ; Ruptures + « Gérer le menu du jour », « Prévisions de production ». |
| **Caisse** | recherche (nom, téléphone, `DB-…`, e-mail), créditer en espèces (reçu), bloquer/débloquer, dernières opérations. |
| **Menu hebdo** | semaine précédente/suivante, date limite, plats par jour et service (prix, quantité prévue), copier la semaine précédente, soumettre / publier, déclarer une rupture, portions servies ; **« Proposer avec l'IA »** (voir §11). |
| **Plats** | catalogue (nom, catégorie, description, composition, kcal, poids, allergènes, prix, photo + crédit obligatoire si CC BY-SA, popularité), recettes (ingrédients × quantité par portion). |
| **Prévisions** | repas attendus, tickets en circulation, portions recommandées par plat (popularité), liste de courses estimée, **brief IA du chef**. |
| **Stock** | ingrédients suivis, sous le seuil, valeur ; entrée (achat), perte, inventaire ; nouvel ingrédient ; derniers mouvements. Les portions servies sont **déduites automatiquement** selon les recettes. |
| **Courses** | fiche automatique (budget estimé), ajout manuel, attribution à un employé + consigne, **« Ranger par rayon avec l'IA »**, suivi, historique. |
| **Ventes** | encaissé par jour, recharges, tickets, en attente, heures de pointe, plats les plus et les moins vendus. |
| **Scans** | date, filtres (service, agent, recherche), indicateurs (tickets scannés, encaissé, avec supplément, plat non précisé), par agent (cliquer pour filtrer), lignes avec badge « 🔑 sans QR », **export CSV** (colonnes : Date, Heure, Client, Identifiant, Service, Plat servi, Supplément, Montant, Agent, Offert par, Fidélité, Validation). |
| **Gaspillage** | saisie des portions préparées après chaque service, préparées − servies = perdues, coût estimé, courbe par jour, par plat. |
| **Avis** | notes par plat, plaintes des 30 derniers jours, derniers avis (photos, commentaires), **répondre au client**. |
| **Affluence** | plan de salle, occupation de la journée, heures de pointe par jour de semaine (4 semaines). |
| **Équipe** | personnel, ajouter un membre (chercher un compte → rôle), bloquer, journal des actions (`audit_log`). |
| **Paramètres** | tickets par type de repas (horaires, prix, suppléments autorisés), argent et sécurité (PIN au-delà de, transferts min/max/jour, alerte solde bas, validité), fidélité, menu hebdomadaire (date limite, jours de service), catégories, suppléments, **double authentification** (cocher les rôles concernés). |

---

## 9. Workflows de bout en bout

### 9.1 Inscription
Formulaire → `auth.signUp` (métadonnées `full_name`, `phone`) → déclencheur `handle_new_user` crée le **profil**
(rôle `client`, identifiant `DB-xxxx` unique) et le **portefeuille** à 0 → étape PIN (`set_pin`, haché bcrypt).
⚠️ Dans Supabase, **« Confirm email » doit être désactivé**, sinon le nouveau compte ne peut pas se connecter.

### 9.2 Recharge
Client : `simulate_recharge(montant)` (Mobile Money simulé) → transaction `recharge`, solde mis à jour en direct.
Caisse : `credit_wallet(user, montant, note)` → `recharge_cash` + reçu + notification `wallet_credited`.

### 9.3 Achat de tickets
`purchase_tickets(service, quantité, suppléments, pin, bénéficiaire, utiliser_points)` vérifie : service ouvert et
pas terminé, prix du réglage, suppléments autorisés (au plus 1 entrée et 1 dessert, actifs), solde suffisant, PIN si > 5 000 F ou
cadeau, points si petit-déjeuner offert ; crée N tickets `valid` (validité 48 h, `qr_nonce` aléatoire 16 octets),
débite le portefeuille (une transaction `purchase`, note « 2 × ticket Déjeuner ») ; cadeau → notification
`meal_gift` au bénéficiaire et `gift_from` sur ses tickets.

### 9.4 QR du ticket (y compris hors ligne)
L'appli appelle l'Edge Function `ticket-token` → jetons signés **`DB1.<id>.<nonce>.<signature>`** (HMAC-SHA256,
base64url) pour **ses** tickets valides → gardés dans le téléphone (`localStorage dabali:qr`) → le QR s'affiche
même en mode avion. Le service worker garde aussi la page de chaque ticket valide.

### 9.5 Scan au comptoir
Caméra → texte du QR. `DABALI:…` = QR de profil → refus explicite. Sinon Edge Function `redeem-ticket` :
vérifie la **signature avant toute requête**, puis `redeem_ticket` (réservée au serveur) fait une **mise à jour
atomique** `valid → used` (un seul scan gagne, même avec 10 scanners), contrôle le service, ajoute **1 point**,
renvoie client, suppléments, nombre de tickets de l'achat, restants, offert par, fidélité, plats du service et
compteurs. L'agent touche le plat → `serve_dish` (décrémente les portions, déduit le stock via les recettes).

### 9.6 Sans téléphone (PIN au comptoir)
`counter_lookup(recherche, service)` puis `redeem_with_pin(code, pin, date, service, téléphone_perdu)` :
ticket du service qui expire le plus tôt, **vérifié avant le PIN** (aucun essai brûlé s'il n'y a pas de ticket),
PIN (3 erreurs = blocage 15 min + alerte `pin_alert` au client), **10 PIN faux par agent en 1 h = mode bloqué**,
validation identique au scan, ticket marqué `redeem_method = 'pin'`, **notification au client** `ticket_pin`
(« Ticket validé avec votre code PIN par Yao à 18h37. Ce n'était pas vous ? … »). Case « téléphone perdu » →
même effet que 9.7.

### 9.7 Téléphone perdu ou volé
Profil → « J'ai perdu mon téléphone » → `secure_my_devices(endpoint_à_garder)` : **nouveaux `qr_nonce`** pour
tous les tickets valides (les anciens QR gardés hors ligne sont refusés), **suppression des autres sessions**
(`auth.sessions`), suppression des abonnements push sauf l'appareil actuel, notification `account_secured`.

### 9.8 Expiration, remboursement, rappel (tâche toutes les 5 min)
`expire_tickets()` : **3 h avant** la fin → rappel `ticket_expiring` (une seule fois, `expiry_reminded_at`) ; à l'expiration → statut `expired` +
**remboursement** (transaction `refund`, note « Remboursement automatique · ticket Déjeuner non utilisé ») +
notification `ticket_refunded` ; ticket fidélité → points rendus.

### 9.9 Avis 30 min après
`request_reviews()` (toutes les 5 min) : ticket utilisé il y a ≥ 30 min, jamais demandé → notification `rate_dish`
(lien `/app/avis/<id>`). Dans l'appli, `pending_review()` ouvre la fenêtre. `rate_ticket(...)` enregistre ;
avis grave (**corps étranger**, ou **note ≤ 2 avec au moins une plainte**) → `review_alert` immédiat au chef. Le chef répond
(`reply_review`) → `review_reply` au client.

### 9.10 Menu de la semaine
Chef : brouillon → `submit_menu` (rappels `menu_reminder`, échéance mercredi 23h59 ; `check_menu_deadlines` toutes
les heures → `menu_deadline_missed` à l'admin) → admin `publish_menu` → **push à tous les clients**
`menu_published` (lien `/app/menu`). `copy_menu_week` duplique la semaine passée. Rupture : `is_sold_out` → grisé
chez les clients en < 3 s (Realtime).

### 9.11 Prévisions et production
`admin_forecast(date)` : repas attendus par service = tickets valides + estimation, réparties par **popularité
bayésienne** (`_dish_popularity` : mélange observé / a priori, K = 8, a priori ivoiriens : alloco 1,45, poulet frites
1,55, attiéké 1,35, garba 1,30… riz 0,8–0,9, salade 0,65), + 5 % de marge ; besoins des recettes vs stock.
Brief IA du chef (§11). Gaspillage = préparées − servies.

### 9.12 Courses automatiques
Quand un ingrédient passe sous son seuil (déclencheur sur `ingredients` + `_shopping_refresh` toutes les 15 min),
un article est ajouté à la **fiche ouverte** (quantité = besoin des 7 prochains jours + seuil − stock ; ignoré si
l'écart est < ¼ du seuil pendant une course en cours ; articles manquants reportés à la fiche suivante).
Le chef attribue la fiche à un employé (`shopping_assign`, push `shopping_assigned`) → l'employé fait ses courses
sur `/courses` → `shopping_complete` crédite le stock (`stock_movements` type `in`) et prévient (`shopping_done`).
« Ranger par rayon » : Edge Function `shopping-organize` (rayon + conditionnement conseillé).

### 9.13 Notifications de service
`notify_service_events()` (toutes les 5 min) : ouverture des services, places libres (« Alerte places libres »),
solde bas, stock bas (`stock_low`).

### 9.14 Hors ligne
Voir §13.

---

## 10. Base de données

Tout est dans `supabase/migrations/` (appliquer **dans l'ordre**, une fois chacune ; le fichier local porte le même
numéro que la version distante). Extensions : `pgcrypto` (bcrypt, octets aléatoires), `pg_cron`, `pg_net`, Vault.

### 10.1 Types énumérés

| Type | Valeurs |
|---|---|
| `user_role` | client · agent · caissier · chef · admin |
| `service_kind` | breakfast · lunch · snack · dinner |
| `ticket_status` | valid · used · expired · cancelled |
| `tx_type` | recharge · recharge_cash · purchase · transfer_in · transfer_out · refund · bonus |
| `menu_status` | draft · submitted · published |
| `extra_kind` | starter · dessert · drink · other |
| `stock_move_type` | in · out · loss · adjust |
| `shopping_status` | open · assigned · shopping · done · cancelled |

### 10.2 Tables (colonnes ; `!` = obligatoire)

| Table | Colonnes |
|---|---|
| `profiles` | id! (= auth.users), full_name!, phone, short_code! (`^DB-[0-9]{4,6}$`, unique), role! (client), pin_hash, pin_failed_attempts! (0), pin_locked_until, points! (0), is_blocked! (false), notify_free_seats! (false), created_at!, **avatar** (`^[a-z0-9-]{1,30}$`) |
| `wallets` | user_id!, balance! (0, jamais négatif), updated_at! |
| `transactions` | id!, user_id!, type! (tx_type), amount! (signé), balance_after!, counterpart_id, ticket_id, performed_by, note, created_at!, counterpart_name (« Nom · DB-xxxx ») |
| `categories` | id!, name!, sort! (Petit-déjeuner 0, Plat du jour 1, Grillades 2, Végétarien 3, + desserts/boissons) |
| `dishes` | id!, name!, category_id, description, composition, kcal, weight_g, allergens![], photo_url, base_price!, is_active!, created_at!, updated_at!, photo_credit, photo_source, popularity_prior! (1,00) |
| `extras` | id!, name!, price!, kind! (extra_kind), is_active!, sort! |
| `menus` | id!, week_start! (lundi), status! (draft), submitted_at, published_at, created_by, created_at! |
| `menu_items` | id!, menu_id!, service_date!, service!, dish_id!, price!, planned_qty, sold_qty! (0), served_qty! (0), prepared_qty, is_sold_out! (false), is_full |
| `tickets` | id!, user_id! (bénéficiaire), buyer_id!, menu_item_id, dish_id (plat servi), extras! (jsonb), total!, status! (valid), service_date, service!, valid_from!, valid_until!, qr_nonce! (16 octets hex), used_at, scanned_by, cancelled_at, created_at!, is_reward!, expiry_reminded_at, gift_from, review_requested_at, review_dismissed_at, **redeem_method! ('qr' \| 'pin')** |
| `ratings` | id!, ticket_id!, user_id!, dish_id!, stars! (1–5), comment, created_at!, author, photo_path (`<uid>/…`), complaints![], reply, replied_at, replied_by |
| `ingredients` | id!, name! (unique), unit!, stock_qty!, alert_threshold!, unit_cost! |
| `recipe_lines` | dish_id!, ingredient_id!, qty_per_portion! |
| `stock_movements` | id!, ingredient_id!, type!, qty!, reason, menu_item_id, created_by, created_at! |
| `shopping_lists` | id!, num! (C-0001…), status!, assigned_to, assigned_by, note, spent_total, created_at!, assigned_at, started_at, done_at, organized_at |
| `shopping_items` | id!, list_id!, ingredient_id, label!, qty!, unit! ('pièce'), est_cost!, reason, source! ('auto'/'manual'), urgent!, status! ('todo'/'bought'/'missing'), bought_qty, paid, added_by, created_at!, updated_at!, aisle, pack_hint |
| `notifications` | id!, user_id!, type!, title!, body, data! (jsonb, `href`), read_at, created_at! |
| `push_subscriptions` | id!, user_id!, endpoint! (unique), p256dh!, auth!, created_at! |
| `rooms` | id!, name!, total_tables!, layout! (jsonb : tables et zones) |
| `occupancy_snapshots` | id!, room_id!, occupied_tables!, total_tables!, rate!, people_count!, table_states!, created_at!, queue_count, counter_count |
| `ai_forecast_briefs` | service_date!, input_hash!, brief! (jsonb), model!, created_at! (cache du brief IA) |
| `settings` | key!, value! (jsonb), updated_at!, updated_by |
| `audit_log` | id!, actor_id, action!, target, payload!, created_at! |

### 10.3 Réglages (`settings`, valeurs actuelles)

```json
services: {
  "breakfast": {"label":"Petit-déjeuner","start":"06:30","end":"09:30","price":500,"extras":false},
  "lunch":     {"label":"Déjeuner","start":"11:30","end":"14:30","price":2500,"extras":true},
  "snack":     {"label":"Snack","start":"15:30","end":"17:00","price":700,"extras":false},
  "dinner":    {"label":"Dîner","start":"17:30","end":"20:00","price":2500,"extras":true}
}
ticket_validity_hours: 48          cancel_cutoff_minutes: 60      presale_days: 7
pin_threshold: 5000                low_balance_threshold: 2000
recharge_limits: {"min":100,"max":500000}
transfer_limits: {"min":100,"max":50000,"daily_max":100000}
loyalty: {"points_per_ticket":1,"reward_points":10,"reward_service":"breakfast"}
menu_deadline: {"weekday":3,"time":"23:59"}       service_days: [1,2,3,4,5,6]
mfa_required_roles: []             push_function_url: "<url de send-push>"
```

### 10.4 Sécurité en base

- **RLS activée partout.** Lecture : chacun voit ses lignes ; le personnel (`is_staff()` = agent, caissier, chef,
  ou admin) voit ce qu'il lui faut. **Droits par colonne** : `profiles` lisible sur (id, full_name, phone, short_code,
  role, points, is_blocked, notify_free_seats, created_at, pin_locked_until, avatar), modifiable par soi-même
  **seulement** sur (full_name, phone, notify_free_seats, avatar). `pin_hash` n'est jamais lisible.
- **Aucune écriture directe** sur l'argent, les tickets, les points : uniquement via les fonctions ci-dessous.
- `has_role(...)` : admin a tous les droits ; si la double authentification est exigée pour le rôle, il faut
  `auth.jwt()->>'aal' = 'aal2'`.
- Toutes les fonctions sensibles sont `SECURITY DEFINER` avec `search_path` figé et renvoient
  `{ ok: true, … }` ou `{ ok: false, code, message }` (messages en français, prêts à afficher).

### 10.5 Fonctions appelables par l'appli (rôle `authenticated`)

| Domaine | Fonctions |
|---|---|
| Compte | `set_pin(p_pin, p_current_pin)`, `lookup_recipient(p_query)`, `secure_my_devices(p_keep_endpoint)` |
| Argent | `simulate_recharge(p_amount)`, `transfer_funds(p_recipient_id, p_amount, p_pin, p_note)`, `credit_wallet(p_user_id, p_amount, p_note)` (caisse) |
| Tickets | `purchase_tickets(p_service, p_quantity, p_extra_ids, p_pin, p_beneficiary_id, p_use_reward)`, `cancel_ticket(p_ticket_id)`, `serve_dish(p_ticket_id, p_menu_item_id)`, `service_counters(p_date, p_service)` |
| Sans téléphone | `counter_lookup(p_query, p_service)`, `redeem_with_pin(p_short_code, p_pin, p_service_date, p_service, p_lost_phone)` |
| Avis | `pending_review()`, `dismiss_review(p_ticket_id)`, `rate_ticket(p_ticket_id, p_stars, p_comment, p_complaints, p_photo_path)`, `my_review(p_ticket_id)`, `reply_review(p_rating_id, p_reply)`, `admin_ratings()` |
| Menus | `submit_menu`, `publish_menu`, `copy_menu_week`, `menu_deadline`, `menu_ai_context`, `apply_menu_proposal(p_week_start, p_items, p_replace)` |
| Pilotage | `admin_overview(p_date)`, `admin_sales(p_from, p_to)`, `admin_forecast(p_date)`, `admin_waste`, `admin_occupancy`, `occupancy_now`, `dish_popularity()`, `stock_inventory`, `admin_find_users`, `admin_set_role`, `set_user_blocked` |
| Courses | `shopping_add`, `shopping_set_qty`, `shopping_assign`, `shopping_start`, `shopping_check`, `shopping_complete`, `shopping_cancel`, `shopping_refresh`, `shopping_staff` |
| Utilitaires | `today_abidjan()`, `service_window`, `service_label`, `setting(key)`, `fcfa()`, `format_fcfa()`, `_num()` (affichage des décimales sans arrondi) |

**Réservées au serveur** (`service_role`) : `redeem_ticket`, `expire_tickets`, `request_reviews`,
`check_menu_deadlines`, `notify_service_events`, `_shopping_refresh`, `_wallet_move` (seul point d'entrée qui
bouge l'argent : verrou, solde jamais négatif, `balance_after`), `_check_pin`, `_secure_account`, `_notify`,
`_notify_roles`, `_audit`, `_anthropic_key`, `_push_config`, `handle_new_user`.

### 10.6 Tâches planifiées (pg_cron)

| Nom | Fréquence | Appel |
|---|---|---|
| `dabali-expire-tickets` | toutes les 5 min | `expire_tickets()` |
| `dabali-request-reviews` | toutes les 5 min | `request_reviews()` |
| `dabali-service-notifications` | toutes les 5 min | `notify_service_events()` |
| `dabali-shopping-refresh` | toutes les 15 min | `_shopping_refresh()` |
| `dabali-menu-deadlines` | à la 5e minute de chaque heure | `check_menu_deadlines()` |

### 10.7 Déclencheurs, temps réel, stockage, secrets

- Déclencheurs : création de profil à l'inscription, application des mouvements de stock, contrôle des lignes de
  menu, mise à jour des courses quand un ingrédient change, **envoi push** à chaque notification (`_push_dispatch` → `pg_net`).
- Realtime écouté : `wallets` (solde), `notifications`, `profiles` (points), `tickets` (passage au vert, historique
  des scans), `menu_items` (ruptures), `shopping_lists` / `shopping_items`, `occupancy_snapshots`.
- Stockage : `dishes` (photos des plats, public), `reviews` (photos d'avis, dossier = identifiant du client).
  Les 17 photos utilisées sont **dans le dépôt** (`public/dishes/*.jpg`, 720×540, < 100 Ko).
- Vault : `anthropic_api_key`, `vapid_private_key`, `vapid_public_key`, `push_webhook_secret`.
  La clé de signature des QR est **dérivée de la clé service_role** (pas de secret à saisir).

---

## 11. Fonctions serveur (Edge Functions) et IA

| Fonction | Entrée | Rôle |
|---|---|---|
| `ticket-token` | `{ ticket_ids? }` + JWT client | renvoie les jetons QR signés de **ses** tickets valides |
| `redeem-ticket` | `{ token, service_date, service }` + JWT agent | vérifie la signature HMAC puis appelle `redeem_ticket` |
| `forecast-assistant` | `{ date }` + JWT chef | **brief du chef** : Claude lit les prévisions du jour et l'historique de gaspillage → conseils chiffrés (mis en cache dans `ai_forecast_briefs` selon un hachage des données) |
| `shopping-organize` | `{ list_id }` | Claude range chaque article par **rayon** et propose un **conditionnement** (« sac de 25 kg ») |
| `menu-assistant` | `{ week_start }` (lundi) + JWT chef | Claude propose le **menu de la semaine** (règles : n'utiliser que les plats fournis, 3 plats au petit-déj, 5–6 au déjeuner, 3 au snack, 4–5 au dîner, pas le même plat 2 jours de suite au même service, plats populaires 2–3 fois, plats mal notés 1 fois, une option légère chaque déjeuner, portions = repas attendus × popularité + 5 %) ; sortie JSON `{resume, items[{date, service, dish_id, planned_qty}], explications}` ; garde-fous côté serveur ; **réponse en flux avec un espace toutes les 10 s** (le calcul dure ~1 min) ; le chef valide (`apply_menu_proposal`). |
| `send-push` | `{ notification_id }` + en-tête `x-push-secret` (sans JWT) | envoie la notification Web Push à tous les appareils du destinataire ; supprime les abonnements expirés |

Paramètres IA communs : modèle `claude-opus-5-5`, `betas: ["server-side-fallback-2026-07-01"]`,
`fallbacks: "default"`, `output_config: { effort: "low" | "medium", format: { type: "json_schema", schema } }`,
clé lue dans `ANTHROPIC_API_KEY` sinon dans Vault (`_anthropic_key`). Erreurs traduites : clé refusée, assistant
saturé, indisponible.

---

## 12. Notifications (dans l'appli et push)

Types utilisés : `wallet_credited`, `transfer_received`, `meal_gift`, `low_balance`, `ticket_refunded`, `ticket_expiring`, `rate_dish`, `review_alert`, `review_reply`, `menu_reminder`, `menu_submitted`, `menu_deadline_missed`,
`menu_published`, `stock_low`, `shopping_assigned`, `shopping_urgent`, `shopping_done`, `shopping_cancelled`,
`ticket_pin`, `pin_alert`, `account_secured`, `free_seats` (places libres) et rappels de service.

Chaîne push : insertion dans `notifications` → déclencheur `_push_dispatch` → `pg_net` POST vers `send-push`
(secret partagé) → Web Push (VAPID) → service worker `push` → notification (icône 192, vibration 80-40-80, `tag` =
type) → `notificationclick` ouvre `data.href` (réutilise l'onglet de l'appli s'il existe).
Activation : interrupteur « Notifications sur ce téléphone » (Profil ; compact dans l'admin). iPhone : iOS ≥ 16.4
et appli ajoutée à l'écran d'accueil (message explicatif sinon).

---

## 13. Appli installable (PWA) et mode hors ligne

- Manifeste (`src/app/manifest.ts`) : nom « Dabali — Cantine connectée », court « Dabali », `start_url /app`,
  `display standalone`, portrait, couleurs `#F6F7F9`, icônes 192/512/maskable, raccourcis « Mon QR » et « Menu ».
  Icône Apple : `/icons/apple-touch-icon.png`.
- Bouton « Installer l'appli » (`install-app.tsx`) : utilise l'invitation `beforeinstallprompt` (gardée dans
  `window.__dabaliInstall`) ; sur iPhone, explique « Partager → Sur l'écran d'accueil ».
- **Service worker** `public/sw.js`, version **`dabali-v5`** :
  - `/_next/static`, `/icons`, polices : cache d'abord ;
  - `/dishes/*` : cache immédiat + mise à jour en arrière-plan ;
  - requêtes RSC : réseau seulement ;
  - pages `/app…` : réseau d'abord, sinon cache ; page jamais vue → **redirection** vers `/app/tickets` ou `/app` ;
  - message **`warm`** : à l'ouverture de l'appli avec du réseau, garde **toutes les pages client et tous leurs
    fichiers JS/CSS** (+ la page de chaque ticket valide) : sans cela, une page s'affiche hors ligne mais ses boutons sont morts ;
  - `push` et `notificationclick` (voir §12).
- **Données gardées sur le téléphone** (`localStorage`) : `dabali:me` (profil + solde), `dabali:tickets`
  (tickets valides), `dabali:qr` (jetons QR), `dabali:tx` (historique), `dabali:notifs`, `dabali:menu`,
  `dabali:dish-stats`, `dabali:services`, `dabali:rewards:<id>`. Historique et menu sont **préchargés** dès
  l'ouverture en ligne.
- Identité lue **sur le téléphone** (`auth.getSession()`), jamais `getUser()` côté client (qui exige le réseau).
- Appels serveur hors ligne → message clair « Pas de connexion internet. Vos QR restent disponibles ; réessayez
  quand le réseau revient. » ; écran d'erreur par page ; bandeau « Hors ligne ».

---

## 14. Sécurité

| Sujet | Mesure |
|---|---|
| QR falsifié ou modifié | jeton HMAC-SHA256 `DB1.<id>.<nonce>.<sig>` vérifié **avant** toute requête ; nonce aléatoire par ticket |
| Double scan | mise à jour atomique `valid → used` (testé avec 10 scans simultanés : 1 seul accepté) |
| Capture d'écran du QR | cadre animé + heure à la seconde ; nonce renouvelable (téléphone perdu) |
| PIN | bcrypt (coût 8), 3 essais puis 15 min de blocage, limites par agent au comptoir, alertes au client |
| Argent | une seule fonction (`_wallet_move`) avec verrou ; solde jamais négatif ; invariant « solde = somme des transactions » vérifié par les tests et par `install.sh` |
| Accès | RLS + droits par colonne + middleware + garde « Page réservée » |
| Personnel | double authentification TOTP activable par rôle (base + middleware) |
| Push | fonction d'envoi protégée par un secret partagé (Vault) |
| Traçabilité | `audit_log` (scans, crédits, PIN bloqués, sécurisation de compte…) |
| Secrets | jamais dans le code ni dans le chat : Vault / secrets des Edge Functions / variables Netlify |

---

## 15. Données de démo

`supabase/seed.sql` (rejouable) + `supabase/data/*.sql`.

| Compte | E-mail | Détails |
|---|---|---|
| Client | `client@dabali.ci` | **Aya Konan**, `DB-2026`, PIN **2580**, bitmoji `aya` |
| Agent | `agent@dabali.ci` | Yao Kouamé |
| Caisse | `caisse@dabali.ci` | |
| Chef | `chef@dabali.ci` | |
| Admin | `admin@dabali.ci` | Bryan Taffo |
| 29 clients | `client01@` … `client29@dabali.ci` | PIN 2580 |

Mot de passe commun : **`Dabali2026!`**.

Plats (17, photos dans `public/dishes/`) : Attiéké poisson braisé, Garba, Riz sauce graine, Riz sauce arachide
poulet, Alloco poulet braisé, Placali sauce kplala, Foutou banane sauce graine, Spaghetti sautés, Salade composée,
**Poulet frites**, Pain beurre & café au lait, Omelette pain, Bouillie de mil, Crêpes sucrées, Brownie, Pain perdu,
Croque-monsieur. Suppléments : Salade de fruits, Yaourt, Gâteau (500 F), Orange (200 F), Pastèque, Ananas,
Mangue (300 F), entrées Salade de crudités et Avocat vinaigrette (500 F), boissons Bissap, Gnamakoudji (300 F), Eau minérale (200 F) (boissons non proposées à l'achat).
Historique de plusieurs semaines (ventes, scans, avis, remboursements) pour que les graphiques soient parlants.
Double authentification désactivée en démo.

---

## 16. Installation et déploiement

1. Créer le projet **Supabase** (≤ 2 projets actifs en gratuit), le site **Netlify** lié au dépôt GitHub, un
   jeton Supabase (`sbp_…`), une **nouvelle** clé Anthropic.
2. `cp scripts/install.env.example scripts/install.env` puis remplir `SUPABASE_DB_URL` (Session pooler),
   `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `ANTHROPIC_API_KEY` (facultatif).
3. `bash scripts/install.sh` : migrations (une fois chacune), données de démo si base vide, clé IA dans Vault,
   clés VAPID générées, adresse de `send-push`, déploiement des 6 fonctions (`send-push` sans vérification JWT),
   vérification des soldes. Relançable. `--local` pour un Postgres local.
4. Netlify → variables `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` (**sinon l'appli pointe sur
   l'ancien projet inscrit par défaut dans `src/lib/config.ts`**). Publication automatique depuis `main`
   (si un envoi n'est pas pris en compte : « Trigger deploy »).
5. Supabase → Authentication : **désactiver « Confirm email »**, **Site URL** = adresse du site.
6. Mettre à jour la clé publique VAPID dans `src/lib/push.ts` si de nouvelles clés ont été générées.
7. Tests (§17), puis répétition de la démo (`RETEX.md` §4).

---

## 17. Tests

- `supabase/tests/run.sh` (Postgres local, en tant qu'utilisateur `postgres`) : applique toutes les migrations sur
  une base jetable puis ~285 vérifications : portefeuille et achats, transferts et PIN, tickets et scan,
  menus et RLS, notifications, prévisions, courses, affluence, avis, double authentification, assistant menu,
  **sans téléphone** (97), **bitmojis** (98), signature des QR (`qr.test.ts`), **concurrence** (`concurrency.sh` :
  10 achats simultanés, dernière portion, 10 scans du même QR, 20 transferts croisés).
- `scripts/e2e-deployed.js` : parcours complet sur le site en ligne (Playwright).
- Vérification visuelle obligatoire avant de dire « fini » : captures sur téléphone (390 px) **avec des données
  accumulées** (points > 10, remboursements, listes longues), **et hors ligne** (`context.setOffline(true)`).

---

## 18. Critères d'acceptation (« identique »)

- [ ] Mêmes couleurs (§4.1), police, rayons, ombres ; même barre du bas flottante avec « Mon QR » central.
- [ ] Mêmes animations aux mêmes endroits (§5.1), mêmes sons et voix au scanner (§5.2), confettis à 10 points.
- [ ] 12 bitmojis identiques, 7 expressions, aux mêmes emplacements (§5.4).
- [ ] Règles de §6 respectées à l'unité près (prix, horaires, 48 h, 60 min, 5 000 F, 3 essais/15 min, limites).
- [ ] Tous les écrans de §8 avec les mêmes textes (français) et le même ordre de blocs.
- [ ] Tous les workflows de §9 fonctionnent de bout en bout sur le site en ligne.
- [ ] Schéma de §10 (types, tables, colonnes, réglages, tâches planifiées, droits) identique.
- [ ] 6 Edge Functions de §11 avec le même comportement.
- [ ] Hors ligne : navigation, QR du ticket, historique et menu visibles sans réseau ; aucun bouton mort.
- [ ] Tous les tests de §17 passent.

---

## 19. Hors périmètre / en attente

- **Caméra de file d'attente (YOLO)** : code prêt dans `vision/` et guide dans `docs/projets/camera-file-attente/`,
  **à ne lancer que sur décision explicite** (« OK caméra »). Sans caméra, l'affluence est estimée à partir du
  rythme des scans.
- Mobile Money réel (actuellement **simulé**), agent WhatsApp de commande pour les étudiants, commande de groupe : pistes pour la suite.
- **Approvisionnement automatique** (fournisseurs, agent vocal, journal Google Sheets, agent WhatsApp, Yango) : **pas encore construit**, spécifié en §20 pour le jour du concours.

---

## 20. À construire le jour du concours : approvisionnement automatique

> **Statut : spécifié, pas encore construit.** Objectif : quand le stock baisse, l'appli trouve les bons
> fournisseurs (ceux chez qui la cantine achète déjà, avec leurs prix), **un agent vocal les appelle**, chaque
> appel est noté dans un **Google Sheet**, et un **agent WhatsApp** publie aussitôt le résultat dans le groupe de la
> cantine. Si un fournisseur ne peut pas livrer, **un coursier Yango** est commandé depuis l'appli.
> Pays : **Côte d'Ivoire** (Abidjan, numéros +225, FCFA, heure d'Abidjan).
> Budget temps : **≈ 1 h en mode simulation** (§20.9) ; le « réel » dépend de comptes externes (§20.8).

### 20.1 Le circuit

```
Stock sous le seuil (déjà en place : fiche de courses automatique, §9.12)
  → fiche découpée par FOURNISSEUR (prix habituels)
  → AGENT 1 « l'appeleur » (vocal) appelle chaque fournisseur
        └─ écrit 1 ligne par appel dans la base + le Google Sheet « Journal des commandes »
  → AGENT 2 « le messager » (WhatsApp, Green API, comme l'agent des livraisons existant)
        └─ dès qu'une ligne apparaît : message immédiat dans le groupe WhatsApp de la cantine
  → si « ne livre pas » : course YANGO commandée par l'appli (auto sous un plafond, sinon validation dans le groupe)
  → réception : l'employé coche « reçu » → le stock remonte (mouvement de stock « in »)
```

Les deux agents **ne se parlent pas** : ils passent par le tableau. Si l'un tombe en panne, l'autre continue, et tout
reste tracé. **La base Dabali reste la référence** ; le Google Sheet en est la copie lisible pour l'équipe et pour
l'agent 2 (une erreur dans le tableau ne dérègle pas l'appli).

### 20.2 Carnet de fournisseurs (nouvelles tables)

| Table | Colonnes |
|---|---|
| `suppliers` | id, name (« Grossiste Koné »), kind (`grossiste` · `marche` · `supermarche` · `boucherie` · `poissonnerie` · `autre`), phone (+225…), whatsapp, district (Adjamé, Cocody, Yopougon…), address, lat, lng, call_hours (ex. « 07:00–12:00 »), delivers (bool), payment_methods (`wave`, `especes`, `orange_money`, `mtn_momo`), notes, is_active |
| `supplier_products` | supplier_id, ingredient_id, usual_price (FCFA par unité de l'ingrédient), pack (« sac 25 kg »), is_preferred (bool), backup_rank (1 = secours principal), last_price, last_price_at |
| `supplier_orders` | id, shopping_list_id, supplier_id, items (jsonb : ingrédient, quantité, prix habituel), budget, status (§20.4), quoted_total, delivery_at, delivery_mode (`fournisseur` · `yango` · `retrait`), payment_method, attempts, call_summary, recording_url, yango_claim_id, yango_price, yango_status, sheet_row, posted_to_group (bool), created_at, updated_at |
| `supplier_calls` | id, supplier_order_id, started_at, ended_at, outcome, transcript, recording_url |

Écran admin **« Fournisseurs »** (chef, admin) : liste, fiche, produits et prix habituels, fournisseur préféré par
ingrédient + secours. Données de démo : 5 fournisseurs d'Abidjan réalistes (grossiste à Adjamé, marché de Cocody,
boucherie à Treichville, poissonnerie à Port-Bouët, supermarché à la Riviera), numéros fictifs +225.

### 20.3 Découpage de la fiche par fournisseur

Pour chaque article de la fiche ouverte : fournisseur **préféré** de l'ingrédient (sinon le moins cher) → une
`supplier_order` par fournisseur, avec budget = Σ quantité × prix habituel. Écran « Courses » : regroupement par
fournisseur, total estimé, bouton « Lancer les appels », et pour chaque fournisseur « Envoyer la commande sur
WhatsApp » (lien `wa.me` avec le message déjà écrit) en secours manuel.

### 20.4 Agent 1, l'appeleur (agent vocal)

- **Outil** : Retell AI (ou Vapi, ElevenLabs Agents), voix française, numéro Twilio. Appels **aux heures d'ouverture**
  du fournisseur seulement, **uniquement vers les numéros du carnet**.
- **Script** : « Bonjour, c'est l'assistant de la cantine Dabali de l'école hôtelière. Cet appel est enregistré. Nous
  voudrions [liste]. Ça fait combien ? Vous pouvez livrer quand ? Sinon on envoie un livreur Yango. Le paiement se
  fait par Wave. »
- **Fonctions** que l'agent appelle pendant l'appel (Edge Function `supplier-call-webhook`, signature vérifiée) :
  `record_quote(total, par_article)`, `confirm_order(delivery_at, delivery_mode, payment)`, `cannot_deliver()`,
  `call_back_at(heure)`, `item_unavailable(article)`.
- **Règles de décision** (dans le code, pas dans l'IA) :

| Situation | Statut | Suite automatique |
|---|---|---|
| Prix dans ±10 % du prix habituel **et** total ≤ budget | `commandé` | confirmation au fournisseur |
| Prix trop haut ou budget dépassé | `a_valider` | « je vérifie avec l'équipe » → message dans le groupe, réponse attendue |
| Pas de réponse / éteint / « pas d'unité » | `injoignable` | 2 nouveaux essais à 15 min, puis **fournisseur de secours** |
| « Je ne suis pas là, rappelez » | `rappeler` | rappel à l'heure dite (ou secours si urgent) |
| « Je ne peux pas livrer » (pas de véhicule, pas de carburant) | `yango` | course Yango (§20.6) |
| Produit manquant | `partiel` | article reporté vers le fournisseur de secours |
| Refus | `refuse` | fournisseur de secours |

- **Garde-fous** : l'agent **ne paie jamais** (le paiement Wave est fait par une personne après validation) ; il ne
  commande que les articles de la fiche, dans le budget ; il annonce être un assistant et que l'appel est enregistré
  (loi ivoirienne sur les données personnelles) ; plafond d'appels par jour.
- **Démo** : l'agent appelle **le téléphone du présentateur** (qui joue le grossiste) devant le jury.

### 20.5 Google Sheet « Journal des commandes » + Agent 2, le messager

Onglet **« Journal »** (1 ligne par appel ou changement de statut, écrite par l'Edge Function via l'API Google Sheets) :

| Date | Heure | Fournisseur | Quartier | Produits et quantités | Prix proposé | Prix habituel | Statut | Livraison | Paiement | Montant | Essais | Résumé de l'appel | Envoyé au groupe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Onglet **« Point du jour »** (formules) : commandes passées, total engagé / budget, à valider, en attente de livraison.

**Agent 2** (Green API, même fonctionnement que l'agent des livraisons existant) : **dès qu'une ligne apparaît** avec
« Envoyé au groupe » = Non → message immédiat dans le groupe WhatsApp de la cantine, puis « Oui ». **Pas d'heure
fixe.** Exemples :

> ✅ **Grossiste Koné (Adjamé)** : riz 2×25 kg + huile 20 L = **57 500 F**, livré demain 9h, Wave à la livraison
> ⚠️ **Boucherie Bamba** : poulet 3 200 F/kg au lieu de 2 800 → **à valider** (répondre « OUI Bamba » ou « NON Bamba »)
> ❌ **Supermarché X** : injoignable (3 essais) → poisson commandé chez **Poissonnerie Y**
> 🛵 **Yango** en route vers Grossiste Koné, arrivée 10h35 · suivi : <lien>

Réponse « OUI Bamba » / « NON Bamba » dans le groupe → l'agent 2 met la ligne à `valide` / `annule` → l'agent 1
rappelle le fournisseur pour confirmer. Green API étant **non officiel**, utiliser un **numéro dédié** (jamais un
numéro personnel). Alternative officielle si besoin : messages WhatsApp individuels au chef et à l'admin, ou groupe
Telegram.

### 20.6 Yango Delivery (coursier commandé par l'appli)

- **API** : Yango Delivery = API « Express (claims) » de Yandex Delivery, hôte `https://b2b.taxi.yandex.net`,
  chemin `/b2b/cargo/integration/v2/…`, jeton Bearer.
- **Accès** : compte **entreprise** Yango Delivery + **contrat** de livraison → onglet « Intégration » → « Obtenir
  un jeton ». Le jeton se range dans les secrets Supabase (`YANGO_DELIVERY_TOKEN`), jamais dans le code ni le chat.
- **Étapes** : estimer le prix → créer la demande (retrait : adresse + téléphone du fournisseur ; livraison : la
  cantine ; contenu) → **accepter** (lance la recherche de coursier, **facturé**) → suivre (position, délai, lien de
  suivi public, téléphone du coursier, code de confirmation) → annuler si besoin (pénalité possible).
- **Règle** : lancement automatique si prix ≤ **plafond du chef** (réglage, ex. 3 000 F) ; sinon « OK ? » dans le
  groupe. Statut interrogé **toutes les minutes** (pas de notification Yango connue). Chaque étape → ligne dans le
  journal → message dans le groupe.
- **À confirmer avec Yango Business Abidjan** : que l'API Express couvre la **Côte d'Ivoire** (cité par une source
  non officielle), le mode de facturation (compte entreprise, pas d'espèces au coursier). Le réseau de l'environnement
  doit autoriser `b2b.taxi.yandex.net`.
- **Mode simulation** (réglage `yango_mode = simulation`) : prix estimé fictif, coursier fictif, statuts qui avancent
  toutes les 30 s, même messages : la démo marche sans compte.

### 20.7 Réception et stock

Écran « Courses » : par commande, « Reçu » (quantités réelles + prix payé + photo du reçu) → mouvement de stock `in`,
mise à jour du **prix habituel** (moyenne glissante), alerte si un prix monte de plus de 15 %, ligne « Livré » dans le
journal et message dans le groupe.

### 20.8 Prérequis (à préparer AVANT le concours)

| Quoi | Pour | Délai |
|---|---|---|
| Liste des vrais fournisseurs (nom, quartier, numéro, produits, prix) | carnet | 30 min |
| Compte Retell AI (ou Vapi) + compte Twilio avec un numéro, Côte d'Ivoire autorisée | appels réels | quelques heures |
| Compte entreprise Yango Delivery + contrat + jeton API, couverture CI confirmée | Yango réel | quelques jours |
| Compte Google (Sheets) partagé avec le compte de service de l'appli | journal | 10 min |
| Agent Green API (numéro dédié) réglé pour lire le nouveau Google Sheet | groupe WhatsApp | 15 min |
| Clés rangées dans les secrets Supabase (jamais dans le chat) | tout | 5 min |

### 20.9 Plan de construction le jour J (≈ 1 h, tout en simulation sauf l'appel de démo)

1. Migration : tables `suppliers`, `supplier_products`, `supplier_orders`, `supplier_calls` + RLS (chef, admin) + données
   de démo d'Abidjan (10 min).
2. Découpage de la fiche par fournisseur + écran « Fournisseurs » + regroupement dans « Courses » (15 min).
3. Edge Function `supplier-call-webhook` + règles de décision §20.4 + écriture du Google Sheet (10 min).
4. Agent vocal en simulation (et un vrai appel vers le téléphone du présentateur si le compte Retell est prêt) (10 min).
5. Yango en simulation (§20.6) (10 min).
6. Tests SQL des règles de décision + vérification des écrans (5–10 min).

### 20.10 Scénario de démo (2 minutes)

1. Admin → Stock : l'huile passe sous le seuil → la fiche se découpe par fournisseur.
2. « Lancer les appels » → **le téléphone du présentateur sonne**, il joue le grossiste : « 21 500 F, je ne peux pas livrer ».
3. Le journal se remplit en direct, le message tombe dans le **groupe WhatsApp**.
4. « Yango en route » avec le lien de suivi → « Livré » → « Reçu » → le stock remonte.
