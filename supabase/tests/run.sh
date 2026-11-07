#!/usr/bin/env bash
# Exécute migrations + tests sur un Postgres local (base jetable).
# Usage : PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=${TEST_DB:-dabali_test}
export PGDATABASE=postgres
psql -qX -c "drop database if exists $DB" -c "create database $DB" >/dev/null
export PGDATABASE=$DB
PSQL=(psql -qX -v ON_ERROR_STOP=1)

echo "▶ migrations"
"${PSQL[@]}" -f 00_local_stubs.sql
for f in ../migrations/*.sql; do echo "  $(basename "$f")"; "${PSQL[@]}" -f "$f" 2>&1 | grep -v "^psql.*NOTICE" || true; done
"${PSQL[@]}" -f 01_helpers.sql

fail=0
for f in [1-9]*.sql; do
  echo "▶ $f"
  if out=$("${PSQL[@]}" -o /dev/null -f "$f" 2>&1); then
    echo "$out" | grep -o "ok - .*" | sed 's/^/  ✔ /' || true
  else
    echo "$out" | grep -o "ok - .*" | sed 's/^/  ✔ /' || true
    echo "$out" | grep -v "NOTICE:  ok" | sed 's/^/  ✘ /' || true
    fail=1
  fi
done

echo "▶ qr.test.ts (signature HMAC)"
node --test qr.test.ts 2>&1 | grep -E "^(not )?ok " | sed -e 's/^ok [0-9]* - /  ✔ ok - /' -e 's/^not ok/  ✘ not ok/' || true
node --test qr.test.ts >/dev/null 2>&1 || fail=1

echo "▶ concurrency.sh"
./concurrency.sh || fail=1

[ $fail = 0 ] && echo "✅ Tous les tests passent" || { echo "❌ Des tests échouent"; exit 1; }
