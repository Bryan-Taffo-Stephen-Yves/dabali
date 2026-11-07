-- Comptoir : scan du ticket (redeem_ticket) puis plat servi (serve_dish), expiration, avis
begin;
select tests.setup();
\set d '(public.today_abidjan() + 1)'

select tests.login('alice');
select public.simulate_recharge(20000);
select (public.purchase_tickets('lunch', 1, array[tests.extra('dessert')]) -> 'ticket_ids' ->> 0) as t1 \gset
select (public.purchase_tickets('lunch') -> 'ticket_ids' ->> 0) as t2 \gset
select (public.purchase_tickets('dinner') -> 'ticket_ids' ->> 0) as t3 \gset
select (public.purchase_tickets('lunch') -> 'ticket_ids' ->> 0) as t4 \gset

select tests.throws(format($$select public.redeem_ticket(%L, 'x', %L, current_date, 'lunch')$$, :'t1', tests.uid('agent')),
                    'client : redeem_ticket non exécutable');
select tests.code(public.serve_dish(:'t1', tests.item('attieke_lunch')), 'FORBIDDEN', 'client : serve_dish interdit');
select tests.login('agent');
select tests.throws(format($$select public.redeem_ticket(%L, 'x', %L, current_date, 'lunch')$$, :'t1', tests.uid('agent')),
                    'agent : redeem_ticket uniquement via l''Edge Function');
select tests.throws($$update public.tickets set status = 'used'$$, 'agent : UPDATE tickets interdit');

select tests.logout();
select qr_nonce as n1 from public.tickets where id = :'t1' \gset
select qr_nonce as n2 from public.tickets where id = :'t2' \gset
select qr_nonce as n3 from public.tickets where id = :'t3' \gset
select qr_nonce as n4 from public.tickets where id = :'t4' \gset

-- ── Étape 1 : scan ──
select tests.as_service();
select tests.code(public.redeem_ticket(:'t1', :'n1', tests.uid('alice'), :d, 'lunch'), 'FORBIDDEN', 'scan par un non-agent refusé');
select tests.code(public.redeem_ticket(:'t1', 'deadbeef', tests.uid('agent'), :d, 'lunch'), 'INVALID_QR', 'nonce faux : QR invalide');
select tests.code(public.redeem_ticket(:'t3', :'n3', tests.uid('agent'), :d, 'lunch'), 'WRONG_SERVICE', 'ticket Dîner présenté au déjeuner');

select public.redeem_ticket(:'t1', :'n1', tests.uid('agent'), :d, 'lunch') as r1 \gset
select tests.ok((:'r1'::jsonb ->> 'ok')::boolean, 'scan valide');
select tests.eq(:'r1'::jsonb ->> 'client', 'Alice Kouassi', 'scan : nom du client');
select tests.eq(:'r1'::jsonb ->> 'ticket', 'Déjeuner', 'scan : type de ticket');
select tests.eq(jsonb_array_length(:'r1'::jsonb -> 'extras'), 1, 'scan : supplément affiché (dessert)');
select tests.eq(jsonb_array_length(:'r1'::jsonb -> 'dishes'), 2, 'scan : plats du déjeuner proposés à l''agent');
select tests.code(public.redeem_ticket(:'t1', :'n1', tests.uid('agent2'), :d, 'lunch'), 'ALREADY_USED', '2e scan refusé');
select tests.ok(public.redeem_ticket(:'t1', :'n1', tests.uid('agent2'), :d, 'lunch') ->> 'message' like '%Agent Yao%', '2e scan : agent du 1er scan indiqué');
-- un ticket vaut pour n'importe quel déjeuner pendant 48 h (ici : aujourd'hui)
select tests.ok((public.redeem_ticket(:'t4', :'n4', tests.uid('agent'), public.today_abidjan(), 'lunch') ->> 'ok')::boolean,
                'ticket utilisable un autre jour dans sa validité');
select tests.logout();
select tests.eq((select points from public.profiles where id = tests.uid('alice')), 2, '+1 point fidélité par scan');
select tests.eq((select service_date from public.tickets where id = :'t1'), (public.today_abidjan() + 1), 'jour d''utilisation enregistré');

-- ── Étape 2 : plat servi ──
select tests.login('agent');
select tests.code(public.serve_dish(:'t2', tests.item('attieke_lunch')), 'TICKET_NOT_FOUND', 'plat avant scan : refusé');
select tests.code(public.serve_dish(:'t1', tests.item('attieke_dinner')), 'WRONG_ITEM', 'plat d''un autre service refusé');
select tests.eq(public.serve_dish(:'t1', tests.item('attieke_lunch')) ->> 'dish', 'Attiéké poisson braisé', 'plat servi enregistré');
select tests.code(public.serve_dish(:'t1', tests.item('garba_lunch')), 'ALREADY_SERVED', 'un seul plat par ticket');
select tests.logout();
select tests.eq((select dish_id from public.tickets where id = :'t1'), (select dish_id from public.menu_items where id = tests.item('attieke_lunch')), 'ticket : plat renseigné');
select tests.eq((select served_qty from public.menu_items where id = tests.item('attieke_lunch')), 1, 'portions servies : 1');
select tests.eq((select stock_qty from public.ingredients where name = 'Poisson'), 9.8::numeric(12,3), 'stock : sortie automatique 0,2 kg');
select tests.ok(exists (select 1 from public.notifications where user_id = tests.uid('chef') and type = 'stock_low'), 'chef alerté stock bas');
select tests.ok(exists (select 1 from public.notifications where user_id = tests.uid('alice') and type = 'rate_dish'), 'demande d''avis après le service');

-- Dernière portion : planned_qty = 2 ; la 2e portion part, la 3e est refusée
select tests.as_service();
select public.redeem_ticket(:'t2', :'n2', tests.uid('agent'), :d, 'lunch');
select tests.logout();
update public.menu_items set planned_qty = 1 where id = tests.item('attieke_lunch');
select tests.login('agent');
select tests.code(public.serve_dish(:'t2', tests.item('attieke_lunch')), 'SOLD_OUT', 'plat épuisé : refusé au comptoir');
select tests.ok((public.serve_dish(:'t2', tests.item('garba_lunch')) ->> 'ok')::boolean, 'l''agent sert un autre plat');

-- ── Avis ──
select tests.login('alice');
select tests.code(public.rate_ticket(:'t4', 5), 'NOT_USED', 'noter sans plat servi : refusé');
select tests.code(public.rate_ticket(:'t1', 6), 'INVALID_STARS', 'note hors 1–5 refusée');
select tests.ok((public.rate_ticket(:'t1', 5, 'Très bon attiéké !') ->> 'ok')::boolean, 'avis enregistré');
select tests.code(public.rate_ticket(:'t1', 4), 'ALREADY_RATED', 'double avis refusé');
select tests.as_anon();
select tests.eq((select author from public.dish_reviews limit 1), 'Alice', 'avis publics : prénom seulement');

-- ── Ticket annulé ──
select tests.login('alice');
select (public.purchase_tickets('lunch') -> 'ticket_ids' ->> 0) as t5 \gset
select public.cancel_ticket(:'t5');
select tests.logout();
select qr_nonce as n5 from public.tickets where id = :'t5' \gset
select tests.as_service();
select tests.code(public.redeem_ticket(:'t5', :'n5', tests.uid('agent'), :d, 'lunch'), 'CANCELLED', 'ticket annulé refusé au scan');

-- ── Expiration (48 h) ──
select tests.logout();
insert into public.tickets (id, user_id, buyer_id, service, total, valid_from, valid_until, qr_nonce)
values ('00000000-0000-0000-0003-000000000001', tests.uid('bob'), tests.uid('bob'), 'lunch', 2500,
        now() - interval '49 hours', now() - interval '1 hour', 'abc');
select tests.as_service();
select tests.code(public.redeem_ticket('00000000-0000-0000-0003-000000000001', 'abc', tests.uid('agent'), current_date, 'lunch'),
                  'EXPIRED', 'ticket de plus de 48 h refusé, même avant le cron');
select tests.ok(public.expire_tickets() >= 1, 'cron expire_tickets');
select tests.logout();
select tests.eq((select status from public.tickets where id = '00000000-0000-0000-0003-000000000001')::text, 'expired', 'ticket expiré');
select tests.login('bob');
select tests.code(public.cancel_ticket('00000000-0000-0000-0003-000000000001'), 'NOT_CANCELLABLE', 'ticket expiré non remboursable');

select tests.logout();
select tests.check_ledger();
rollback;
