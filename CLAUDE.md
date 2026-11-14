# Dabali — consignes pour Claude

## Façon de travailler avec Bryan (propriétaire du projet)

- **Toujours donner les liens directs.** Dès qu'une action manuelle est nécessaire (créer un compte, déposer une clé ou un
  secret, connecter un service, vérifier un réglage, coller un script SQL…), envoyer **tous les liens en une seule fois**,
  chacun pointant exactement sur la bonne page (pas seulement la page d'accueil du service), avec une ligne sur quoi faire
  et quel nom donner (ex. nom exact du secret). Bryan clique, fait l'action et répond « fait ».
- Ne jamais demander qu'une clé API ou un mot de passe soit collé dans le chat : donner le lien de la page où le déposer
  (ex. secrets Supabase) et le nom exact à utiliser.
- Répondre en français, simplement.

## Liens utiles (projet Supabase `punghxwtknejxkedaoty`)

- Secrets des Edge Functions : https://supabase.com/dashboard/project/punghxwtknejxkedaoty/functions/secrets
- Éditeur SQL : https://supabase.com/dashboard/project/punghxwtknejxkedaoty/sql/new
- Edge Functions : https://supabase.com/dashboard/project/punghxwtknejxkedaoty/functions
- Authentification (réglages) : https://supabase.com/dashboard/project/punghxwtknejxkedaoty/auth/providers
- Clés API Anthropic : https://console.anthropic.com/settings/keys
- Site en ligne : https://dabalix.netlify.app — déploiements Netlify : https://app.netlify.com
- Dépôt : https://github.com/Bryan-Taffo-Stephen-Yves/dabali

## Kit de démarrage (à faire au tout début d'un nouveau projet ou d'une reconstruction)

Dès le « on commence », envoyer d'un coup à Bryan la liste des comptes à créer et des clés à déposer dans les secrets
Supabase (lien direct + nom exact), pendant que Claude code en parallèle. Les services externes sont pilotés par leur API
depuis des Edge Functions (les clés restent dans Supabase, Claude ne les voit jamais) :

| Service | Secret Supabase | Sert à |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` (+ `_JEAN`) | assistants IA, Jean |
| Green API (WhatsApp) | `GREEN_API_TOKEN_JEAN` + id/URL de l'instance dans `settings.jean` | Jean sur WhatsApp |
| Webhook Jean | `JEAN_WEBHOOK_TOKEN` (aussi dans Green API « Webhook authorization header ») | sécurise les messages entrants |
| ElevenLabs | `ELEVENLABS_API_KEY` (droit **Speech to Text** coché !) | notes vocales → texte |
| Retell | `RETELL_API_KEY` + `JEAN_VOICE_TOKEN` | Jean au téléphone ; `retell-setup` configure l'agent par l'API |
| Meta WhatsApp Cloud | (à créer tôt : validation de plusieurs jours) | boutons officiels, WhatsApp Flows (PIN masqué), rappels |

Pièges déjà rencontrés : une Edge Function déjà démarrée peut garder l'ancienne valeur d'un secret → la redéployer après
un changement de clé ; vérifier les droits d'une clé (ElevenLabs) avant de chercher un bug ; un numéro WhatsApp = une
seule instance Green API (prévoir une puce dédiée).

## Repères techniques

- Next.js 15 + Tailwind 4 + Supabase ; interface en français, FCFA, fuseau Africa/Abidjan.
- Tests base de données : `service postgresql start` puis `cd supabase/tests && su postgres -c "./run.sh"`.
- Toute nouvelle colonne lue par l'appli doit exister en base AVANT de pousser le front sur `main` (Netlify déploie `main`).
- Cahier des charges : `docs/CAHIER_DES_CHARGES.md` ; retours d'expérience : `docs/RETEX.md`.
