#!/usr/bin/env bash
# Tests de concurrence : sessions Postgres réellement parallèles (données committées dans la base de test).
set -euo pipefail
PSQL=(psql -qXAt -v ON_ERROR_STOP=1)
as_user() { # $1 = nom du compte de test, $2 = requête
  "${PSQL[@]}" -c "begin; select tests.login('$1'); $2; commit;" | tail -n +2 | head -n 1
}
check() { if [ "$1" = "$2" ]; then echo "  ✔ ok - $3"; else echo "  ✘ ÉCHEC : $3 (obtenu $1, attendu $2)"; exit 1; fi; }
D="public.today_abidjan() + 1"

"${PSQL[@]}" -c "select tests.setup()" >/dev/null

# 1) 10 achats simultanés d'un ticket Déjeuner (2 500) avec 5 000 de solde → exactement 2 réussissent
as_user alice "select public.simulate_recharge(5000)" >/dev/null
for i in $(seq 10); do
  as_user alice "select public.purchase_tickets('lunch') ->> 'ok'" > "/tmp/dabali_buy_$i" &
done; wait
ok=$(cat /tmp/dabali_buy_* | grep -c true || true); rm -f /tmp/dabali_buy_*
check "$ok" 2 "10 achats simultanés, solde 5 000 : 2 réussissent"
check "$("${PSQL[@]}" -c "select balance from wallets where user_id = tests.uid('alice')")" 0 "solde final 0, jamais négatif"

# 2) dernière portion : 8 agents servent le même plat (planned_qty = 1) en même temps → 1 seule portion
as_user bob "select public.simulate_recharge(30000)" >/dev/null
as_user bob "select public.set_pin('2580')" >/dev/null
as_user bob "select public.purchase_tickets('dinner', 8, '{}', '2580')" >/dev/null
"${PSQL[@]}" -c "update menu_items set planned_qty = 1 where id = tests.item('attieke_dinner');
                 set role service_role;
                 select public.redeem_ticket(id, qr_nonce, tests.uid('agent'), $D, 'dinner') from tickets
                  where user_id = tests.uid('bob') and service = 'dinner' and status = 'valid'" >/dev/null
for t in $("${PSQL[@]}" -c "select id from tickets where user_id = tests.uid('bob') and service = 'dinner' and status = 'used'"); do
  as_user agent "select public.serve_dish('$t', tests.item('attieke_dinner')) ->> 'ok'" > "/tmp/dabali_serve_$t" &
done; wait
ok=$(cat /tmp/dabali_serve_* | grep -c true || true); rm -f /tmp/dabali_serve_*
check "$ok" 1 "dernière portion servie par 8 agents en même temps : 1 seule"
check "$("${PSQL[@]}" -c "select served_qty from menu_items where id = tests.item('attieke_dinner')")" 1 "pas de portion servie en trop"

# 3) le même ticket scanné par 10 scanners en même temps → 1 seul succès
tid=$(as_user bob "select public.purchase_tickets('lunch') -> 'ticket_ids' ->> 0")
nonce=$("${PSQL[@]}" -c "select qr_nonce from tickets where id = '$tid'")
for i in $(seq 10); do
  "${PSQL[@]}" -c "set role service_role; select public.redeem_ticket('$tid', '$nonce', tests.uid('agent'), $D, 'lunch') ->> 'ok'" \
    > "/tmp/dabali_scan_$i" &
done; wait
ok=$(cat /tmp/dabali_scan_* | grep -c true || true); rm -f /tmp/dabali_scan_*
check "$ok" 1 "10 scans simultanés du même QR : 1 seul accepté"
check "$("${PSQL[@]}" -c "select count(*) from tickets where id = '$tid' and status = 'used'")" 1 "ticket utilisé une seule fois"

# 4) le compteur d'échecs PIN persiste entre les requêtes (une requête = une transaction)
for i in 1 2 3; do code=$(as_user bob "select public.transfer_funds(tests.uid('alice'), 1000, '0000') ->> 'code'"); done
check "$code" "PIN_LOCKED" "3 PIN faux dans 3 requêtes séparées → blocage"
check "$(as_user bob "select public.transfer_funds(tests.uid('alice'), 1000, '2580') ->> 'code'")" "PIN_LOCKED" "bon PIN refusé pendant 15 min"

# 5) transferts croisés simultanés A→B et B→A : pas d'interblocage
as_user alice "select public.set_pin('2580')" >/dev/null
"${PSQL[@]}" -c "update profiles set pin_locked_until = null where id = tests.uid('bob');
                 update settings set value = '{\"min\":100,\"max\":50000,\"daily_max\":10000000}' where key = 'transfer_limits'" >/dev/null
as_user alice "select public.simulate_recharge(100000)" >/dev/null
as_user bob "select public.simulate_recharge(100000)" >/dev/null
for i in $(seq 10); do
  as_user alice "select public.transfer_funds(tests.uid('bob'), 1000, '2580') ->> 'ok'" > "/tmp/dabali_x_a$i" &
  as_user bob   "select public.transfer_funds(tests.uid('alice'), 1000, '2580') ->> 'ok'" > "/tmp/dabali_x_b$i" &
done; wait
ok=$(cat /tmp/dabali_x_* | grep -c true || true); rm -f /tmp/dabali_x_*
check "$ok" 20 "20 transferts croisés simultanés sans interblocage"

"${PSQL[@]}" -c "select tests.check_ledger()" >/dev/null && echo "  ✔ ok - invariant : solde = somme des transactions (après concurrence)"
