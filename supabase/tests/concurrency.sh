#!/usr/bin/env bash
# Tests de concurrence : sessions Postgres réellement parallèles (données committées dans la base de test).
set -euo pipefail
PSQL=(psql -qXAt -v ON_ERROR_STOP=1)
as_user() { # $1 = nom du compte de test, $2 = requête
  "${PSQL[@]}" -c "begin; select tests.login('$1'); $2; commit;" | tail -n +2 | head -n 1
}
check() { if [ "$1" = "$2" ]; then echo "  ✔ ok - $3"; else echo "  ✘ ÉCHEC : $3 (obtenu $1, attendu $2)"; exit 1; fi; }

"${PSQL[@]}" -c "select tests.setup()" >/dev/null

# 1) 10 achats simultanés de 1 500 avec 5 000 de solde → exactement 3 réussissent
as_user alice "select public.simulate_recharge(5000)" >/dev/null
for i in $(seq 10); do
  as_user alice "select public.purchase_ticket(tests.item('garba_lunch')) ->> 'ok'" > "/tmp/dabali_buy_$i" &
done; wait
ok=$(cat /tmp/dabali_buy_* | grep -c true || true); rm -f /tmp/dabali_buy_*
check "$ok" 3 "10 achats simultanés, solde 5 000 : 3 réussissent"
check "$("${PSQL[@]}" -c "select balance from wallets where user_id = tests.uid('alice')")" 500 "solde final 500, jamais négatif"

# 2) dernière portion achetée par 8 clients en même temps → 1 seul gagnant
"${PSQL[@]}" -c "update menu_items set planned_qty = 1 where id = tests.item('attieke_dinner')" >/dev/null
for i in $(seq 8); do
  "${PSQL[@]}" -c "insert into auth.users (email, raw_user_meta_data) values ('c$i@dabali.test', '{\"full_name\":\"Client $i\"}')" >/dev/null
done
"${PSQL[@]}" -c "update wallets set balance = 10000 where user_id in (select id from auth.users where email like 'c_@dabali.test');
                 insert into transactions (user_id, type, amount, balance_after) select id, 'bonus', 10000, 10000 from auth.users where email like 'c_@dabali.test'" >/dev/null
for i in $(seq 8); do
  "${PSQL[@]}" -c "begin; select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'c$i@dabali.test'))::text, true);
                   set local role authenticated; select public.purchase_ticket(tests.item('attieke_dinner')) ->> 'code'; commit;" \
    | sed -n 2p > "/tmp/dabali_last_$i" &
done; wait
ok=$(cat /tmp/dabali_last_* | grep -cx "" || true); rm -f /tmp/dabali_last_*
check "$ok" 1 "dernière portion disputée par 8 clients : 1 seul achat"
check "$("${PSQL[@]}" -c "select sold_qty from menu_items where id = tests.item('attieke_dinner')")" 1 "pas de survente"

# 3) le même ticket scanné par 10 scanners en même temps → 1 seul succès
as_user bob "select public.simulate_recharge(5000)" >/dev/null
tid=$(as_user bob "select public.purchase_ticket(tests.item('attieke_lunch')) ->> 'ticket_id'")
nonce=$("${PSQL[@]}" -c "select qr_nonce from tickets where id = '$tid'")
for i in $(seq 10); do
  "${PSQL[@]}" -c "set role service_role; select public.redeem_ticket('$tid', '$nonce', tests.uid('agent'), public.today_abidjan() + 1, 'lunch') ->> 'ok'" \
    > "/tmp/dabali_scan_$i" &
done; wait
ok=$(cat /tmp/dabali_scan_* | grep -c true || true); rm -f /tmp/dabali_scan_*
check "$ok" 1 "10 scans simultanés du même QR : 1 seul accepté"
check "$("${PSQL[@]}" -c "select served_qty from menu_items where id = tests.item('attieke_lunch')")" 1 "servi une seule fois"

# 4) le compteur d'échecs PIN persiste entre les requêtes (une requête = une transaction)
as_user bob "select public.set_pin('2580')" >/dev/null
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
