#!/usr/bin/env bash
# Test de bout en bout contre le projet Supabase : QR signé → scan → double scan → QR falsifié → écriture interdite.
set -uo pipefail
U=${SUPABASE_URL:?}; K=${SUPABASE_ANON_KEY:?}
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
login() { curl -s "$U/auth/v1/token?grant_type=password" -H "apikey: $K" -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"Dabali2026!\"}" | j "d['access_token']"; }
api() { curl -s "$@" -H "apikey: $K" -H "Content-Type: application/json"; }

C=$(login client@dabali.ci); A=$(login agent@dabali.ci)
echo "solde client : $(api "$U/rest/v1/wallets?select=balance" -H "Authorization: Bearer $C")"
T=$(api -X POST "$U/functions/v1/ticket-token" -H "Authorization: Bearer $C" -d '{}')
echo "tickets valides avec QR : $(echo "$T" | j "len(d['tokens'])")"
TOK=$(echo "$T" | j "d['tokens'][0]['token']"); TID=$(echo "$T" | j "d['tokens'][0]['ticket_id']")
echo "jeton : $TOK"
INFO=$(api "$U/rest/v1/tickets?select=service_date,service&id=eq.$TID" -H "Authorization: Bearer $C")
D=$(echo "$INFO" | j "d[0]['service_date']"); S=$(echo "$INFO" | j "d[0]['service']")
scan() { api -X POST "$U/functions/v1/redeem-ticket" -H "Authorization: Bearer $2" -d "{\"token\":\"$1\",\"service_date\":\"$D\",\"service\":\"$S\"}"; echo; }
echo "— scan client (interdit) :"; scan "$TOK" "$C"
echo "— QR falsifié :";            scan "${TOK%??}AA" "$A"
echo "— 1er scan agent :";         scan "$TOK" "$A"
echo "— 2e scan agent :";          scan "$TOK" "$A"
echo "— UPDATE direct du solde : $(api -X PATCH "$U/rest/v1/wallets?user_id=not.is.null" -H "Authorization: Bearer $C" -d '{"balance":999999}')"
echo "— lecture qr_nonce : $(api "$U/rest/v1/tickets?select=qr_nonce&limit=1" -H "Authorization: Bearer $C")"
