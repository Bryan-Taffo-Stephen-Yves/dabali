-- Scan des tickets, expiration, avis
begin;
select tests.setup();
\set d '(public.today_abidjan() + 1)'

select tests.login('alice');
select public.simulate_recharge(20000);
select (public.purchase_ticket(tests.item('attieke_lunch'), array[tests.extra('bissap')]) ->> 'ticket_id') as t1 \gset
select (public.purchase_ticket(tests.item('garba_lunch')) ->> 'ticket_id') as t2 \gset
select (public.purchase_ticket(tests.item('attieke_dinner')) ->> 'ticket_id') as t3 \gset

-- Un client (ou un agent) ne peut pas appeler redeem_ticket directement : il doit passer par l'Edge Function
select tests.throws(format($$select public.redeem_ticket(%L, 'x', %L, current_date, 'lunch')$$, :'t1', tests.uid('agent')),
                    'client : redeem_ticket non exécutable');
select tests.login('agent');
select tests.throws(format($$select public.redeem_ticket(%L, 'x', %L, current_date, 'lunch')$$, :'t1', tests.uid('agent')),
                    'agent : redeem_ticket non exécutable sans passer par l''Edge Function');
select tests.throws($$update public.tickets set status = 'used'$$, 'agent : UPDATE tickets interdit');

select tests.logout();
select qr_nonce as n1 from public.tickets where id = :'t1' \gset
select qr_nonce as n2 from public.tickets where id = :'t2' \gset
select qr_nonce as n3 from public.tickets where id = :'t3' \gset

-- ── Scan (service_role = Edge Function) ──
select tests.as_service();
select tests.code(public.redeem_ticket(:'t1', :'n1', tests.uid('alice'), :d, 'lunch'), 'FORBIDDEN', 'scan par un non-agent refusé');
select tests.code(public.redeem_ticket(:'t1', 'deadbeef', tests.uid('agent'), :d, 'lunch'), 'INVALID_QR', 'nonce faux : QR invalide');
select tests.code(public.redeem_ticket(gen_random_uuid(), :'n1', tests.uid('agent'), :d, 'lunch'), 'INVALID_QR', 'ticket inconnu : QR invalide');
select tests.code(public.redeem_ticket(:'t3', :'n3', tests.uid('agent'), :d, 'lunch'), 'WRONG_SERVICE', 'ticket du dîner scanné au déjeuner');
select tests.code(public.redeem_ticket(:'t1', :'n1', tests.uid('agent'), :d - 1, 'lunch'), 'WRONG_SERVICE', 'ticket scanné le mauvais jour');

select public.redeem_ticket(:'t1', :'n1', tests.uid('agent'), :d, 'lunch') as r1 \gset
select tests.ok((:'r1'::jsonb ->> 'ok')::boolean, 'scan valide');
select tests.eq(:'r1'::jsonb ->> 'client', 'Alice Kouassi', 'scan : nom du client renvoyé');
select tests.eq(:'r1'::jsonb ->> 'dish', 'Attiéké poisson braisé', 'scan : plat renvoyé');
select tests.eq((:'r1'::jsonb -> 'counters' ->> 'served')::int, 1, 'compteur servis = 1');
select tests.eq((:'r1'::jsonb -> 'counters' ->> 'sold')::int, 2, 'compteur vendus = 2');

select tests.code(public.redeem_ticket(:'t1', :'n1', tests.uid('agent2'), :d, 'lunch'), 'ALREADY_USED', '2e scan refusé');
select tests.ok(public.redeem_ticket(:'t1', :'n1', tests.uid('agent2'), :d, 'lunch') ->> 'message' like '%Agent Yao%',
                '2e scan : indique l''agent du 1er scan');

select tests.logout();
select tests.eq((select status from public.tickets where id = :'t1')::text, 'used', 'ticket utilisé');
select tests.eq((select scanned_by from public.tickets where id = :'t1'), tests.uid('agent'), 'scanned_by = agent');
select tests.eq((select points from public.profiles where id = tests.uid('alice')), 1, '+1 point fidélité au scan');
select tests.eq((select served_qty from public.menu_items where id = tests.item('attieke_lunch')), 1, 'served_qty incrémenté');
select tests.eq((select stock_qty from public.ingredients where name = 'Poisson'), 9.8::numeric(12,3), 'stock : sortie automatique 0,2 kg de poisson');
select tests.ok(exists (select 1 from public.notifications where user_id = tests.uid('chef') and type = 'stock_low'), 'chef alerté stock bas');
select tests.ok(exists (select 1 from public.notifications where user_id = tests.uid('alice') and type = 'rate_dish'), 'demande d''avis après scan');
select tests.ok(exists (select 1 from public.audit_log where action = 'redeem_ticket' and actor_id = tests.uid('agent')), 'scan journalisé');

-- ── Avis ──
select tests.login('alice');
select tests.code(public.rate_ticket(:'t2', 5), 'NOT_USED', 'noter un ticket non utilisé : refusé');
select tests.code(public.rate_ticket(:'t1', 6), 'INVALID_STARS', 'note hors 1–5 refusée');
select tests.ok((public.rate_ticket(:'t1', 5, 'Très bon attiéké !') ->> 'ok')::boolean, 'avis enregistré');
select tests.code(public.rate_ticket(:'t1', 4), 'ALREADY_RATED', 'double avis refusé');
select tests.as_anon();
select tests.eq((select author from public.dish_reviews limit 1), 'Alice', 'avis publics : prénom seulement');
select tests.eq((select avg_stars from public.dish_stats where avg_stars is not null), 5.0, 'note moyenne du plat');

-- ── Ticket annulé ──
select tests.login('alice');
select public.cancel_ticket(:'t2');
select tests.as_service();
select tests.code(public.redeem_ticket(:'t2', :'n2', tests.uid('agent'), :d, 'lunch'), 'CANCELLED', 'ticket annulé refusé au scan');

-- ── Expiration (cron) ──
select tests.logout();
insert into public.tickets (id, user_id, buyer_id, menu_item_id, dish_id, total, service_date, service, valid_from, valid_until, qr_nonce)
select '00000000-0000-0000-0003-000000000001', tests.uid('bob'), tests.uid('bob'), mi.id, mi.dish_id, 0,
       current_date, 'lunch', now() - interval '4 hours', now() - interval '1 minute', 'abc'
  from public.menu_items mi where mi.id = tests.item('garba_lunch');
select tests.as_service();
select tests.code(public.redeem_ticket('00000000-0000-0000-0003-000000000001', 'abc', tests.uid('agent'), current_date, 'lunch'),
                  'EXPIRED', 'service terminé : refusé même avant le passage du cron');
select tests.ok(public.expire_tickets() >= 1, 'cron expire_tickets');
select tests.logout();
select tests.eq((select status from public.tickets where id = '00000000-0000-0000-0003-000000000001')::text, 'expired',
                'ticket non utilisé → expiré après la fin du service');
select tests.eq((select status from public.tickets where id = :'t3')::text, 'valid', 'ticket futur non expiré');

-- ── Annulation trop tardive ──
insert into public.tickets (id, user_id, buyer_id, menu_item_id, dish_id, total, service_date, service, valid_from, valid_until)
select '00000000-0000-0000-0003-000000000002', tests.uid('bob'), tests.uid('bob'), mi.id, mi.dish_id, 1500,
       current_date, 'dinner', now() + interval '30 minutes', now() + interval '3 hours'
  from public.menu_items mi where mi.id = tests.item('garba_lunch');
select tests.login('bob');
select tests.code(public.cancel_ticket('00000000-0000-0000-0003-000000000002'), 'CANCEL_TOO_LATE', 'annulation < 1 h avant le service refusée');

select tests.logout();
select tests.check_ledger();
rollback;
