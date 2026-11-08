#!/usr/bin/env bash
# Dabali — installation complète d'un projet Supabase en une commande.
#
#   1. migrations (dans l'ordre, une seule fois chacune)   4. Edge Functions (4)
#   2. données de démo (si la base est vide)                 5. vérifications
#   3. clé Anthropic dans Supabase Vault (si fournie)
#
# Usage :
#   cp scripts/install.env.example scripts/install.env   # puis remplir
#   bash scripts/install.sh
#
# Options : --no-seed (pas de données de démo) · --no-functions · --local (Postgres local de test, sans Supabase)
set -euo pipefail
cd "$(dirname "$0")/.."

SEED=1; FUNCTIONS=1; LOCAL=0
for a in "$@"; do
  case "$a" in
    --no-seed) SEED=0 ;;
    --no-functions) FUNCTIONS=0 ;;
    --local) LOCAL=1; FUNCTIONS=0 ;;
    -h|--help) sed -n 2,13p "$0"; exit 0 ;;
    *) echo "Option inconnue : $a"; exit 1 ;;
  esac
done

[ -f scripts/install.env ] && set -a && . scripts/install.env && set +a

step() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✘ %s\033[0m\n' "$*"; exit 1; }

# ── 0. Prérequis ──
step "Vérifications"
command -v psql >/dev/null || die "psql est requis (sudo apt install postgresql-client · brew install libpq)"
if [ "$LOCAL" = 1 ]; then
  DB_URL="${DB_URL:-postgresql:///dabali_install}"
  psql -qX -d postgres -c "drop database if exists dabali_install" -c "create database dabali_install" >/dev/null
  ok "base locale de test : $DB_URL"
else
  DB_URL="${SUPABASE_DB_URL:?SUPABASE_DB_URL manquant (Supabase → Connect → Session pooler, avec le mot de passe)}"
  : "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF manquant (ex. punghxwtknejxkedaoty)}"
  if [ "$FUNCTIONS" = 1 ]; then
    command -v npx >/dev/null || die "Node.js (npx) est requis pour déployer les Edge Functions"
    : "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN manquant (supabase.com/dashboard/account/tokens)}"
  fi
fi
PSQL=(psql -qX -v ON_ERROR_STOP=1 -d "$DB_URL")
"${PSQL[@]}" -c "select 1" >/dev/null || die "Connexion à la base impossible"
ok "connexion à la base"
[ "$LOCAL" = 1 ] && "${PSQL[@]}" -f supabase/tests/00_local_stubs.sql >/dev/null && ok "simulateurs auth/vault chargés (mode local)"

# ── 1. Migrations ──
step "Migrations"
"${PSQL[@]}" >/dev/null <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
SQL
applied=0; skipped=0
for f in supabase/migrations/*.sql; do
  base=$(basename "$f" .sql); version=${base%%_*}; name=${base#*_}
  if [ "$("${PSQL[@]}" -At -c "select 1 from supabase_migrations.schema_migrations where version = '$version'")" = "1" ]; then
    skipped=$((skipped + 1)); continue
  fi
  "${PSQL[@]}" -1 -f "$f" >/dev/null 2>&1 || { "${PSQL[@]}" -1 -f "$f" 2>&1 | grep -v NOTICE | tail -5; die "Échec de la migration $base"; }
  "${PSQL[@]}" -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')" >/dev/null
  ok "$base"; applied=$((applied + 1))
done
ok "$applied appliquée(s), $skipped déjà en place"

# ── 2. Données de démo ──
step "Données de démo"
if [ "$SEED" = 0 ]; then
  warn "ignorées (--no-seed)"
elif [ "$("${PSQL[@]}" -At -c "select count(*) from public.dishes")" != "0" ]; then
  warn "la base contient déjà des plats : données de démo non rechargées"
else
  "${PSQL[@]}" -f supabase/seed.sql 2>&1 | grep -v NOTICE | grep -v '^$' || true
  ok "comptes de démo (mot de passe Dabali2026!), plats + photos, menus, historique"
fi

# ── 3. Clé Anthropic (assistant IA : prévisions, rangement des courses) ──
step "Clé Anthropic"
if [ -n "${ANTHROPIC_API_KEY:-}" ] && [ "$LOCAL" = 0 ]; then
  "${PSQL[@]}" -v key="$ANTHROPIC_API_KEY" >/dev/null <<'SQL'
select case when exists (select 1 from vault.secrets where name = 'anthropic_api_key')
            then vault.update_secret((select id from vault.secrets where name = 'anthropic_api_key'), :'key')::text
            else vault.create_secret(:'key', 'anthropic_api_key', 'Clé API Anthropic — assistant IA')::text end;
SQL
  ok "enregistrée dans Supabase Vault (lisible uniquement par les Edge Functions)"
else
  warn "ANTHROPIC_API_KEY absente : l'app marche, sauf les boutons d'assistant IA"
fi

# ── 3 bis. Notifications push : clés VAPID générées une fois, rangées dans Vault ──
step "Notifications push"
if [ "$LOCAL" = 0 ]; then
  if [ "$("${PSQL[@]}" -At -c "select count(*) from vault.secrets where name = 'vapid_private_key'")" = "0" ]; then
    keys=$(npx --yes web-push@3.6.7 generate-vapid-keys --json)
    pub=$(node -e "console.log(JSON.parse(process.argv[1]).publicKey)" "$keys"); priv=$(node -e "console.log(JSON.parse(process.argv[1]).privateKey)" "$keys")
    "${PSQL[@]}" -v pub="$pub" -v priv="$priv" >/dev/null <<'SQL'
select vault.create_secret(:'priv', 'vapid_private_key', 'Clé privée VAPID'), vault.create_secret(:'pub', 'vapid_public_key', 'Clé publique VAPID'),
       vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'push_webhook_secret', 'Secret base → send-push');
SQL
    ok "clés VAPID créées · clé publique à mettre dans Netlify : NEXT_PUBLIC_VAPID_PUBLIC_KEY=$pub"
  else
    ok "clés VAPID déjà en place"
  fi
  "${PSQL[@]}" -c "update public.settings set value = to_jsonb('https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/send-push'::text) where key = 'push_function_url'" >/dev/null
  ok "envoi automatique branché (pg_net → send-push)"
else
  warn "ignoré en mode local"
fi

# ── 4. Edge Functions ──
step "Edge Functions"
if [ "$FUNCTIONS" = 1 ]; then
  for fn in ticket-token redeem-ticket forecast-assistant shopping-organize menu-assistant send-push; do
    extra=""; [ "$fn" = send-push ] && extra="--no-verify-jwt"   # appelée par la base avec un secret, pas par un utilisateur
    npx --yes supabase@latest functions deploy "$fn" --project-ref "$SUPABASE_PROJECT_REF" --use-api $extra >/dev/null \
      || die "Déploiement de $fn impossible"
    ok "$fn"
  done
else
  warn "non déployées (--no-functions / --local)"
fi

# ── 5. Vérifications ──
step "Vérifications"
"${PSQL[@]}" -At -F ' ' <<'SQL' | while read -r label value; do ok "$label : $value"; done
select 'plats', count(*) from public.dishes
union all select 'plats_sans_photo', count(*) from public.dishes where is_active and coalesce(photo_url, '') = ''
union all select 'comptes', count(*) from public.profiles
union all select 'tickets', count(*) from public.tickets
union all select 'soldes_incoherents', count(*) from public.wallets w
  where balance <> (select coalesce(sum(amount), 0) from public.transactions t where t.user_id = w.user_id);
SQL
bad=$("${PSQL[@]}" -At -c "select count(*) from public.wallets w where balance <> (select coalesce(sum(amount), 0) from public.transactions t where t.user_id = w.user_id)")
[ "$bad" = "0" ] || die "Des soldes ne correspondent pas à l'historique des transactions"

step "Terminé"
if [ "$LOCAL" = 0 ]; then
  cat <<EOF
  Il reste 3 réglages dans les tableaux de bord (2 min) :
   1. Supabase → Authentication → Sign In / Providers → Email : désactiver « Confirm email »
   2. Supabase → Authentication → URL Configuration : Site URL = l'adresse Netlify
   3. Netlify → Site configuration → Environment variables :
        NEXT_PUBLIC_SUPABASE_URL      = https://$SUPABASE_PROJECT_REF.supabase.co
        NEXT_PUBLIC_SUPABASE_ANON_KEY = (Supabase → Project Settings → API Keys → anon)
      puis « Trigger deploy ».
EOF
fi
