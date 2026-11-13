-- Commandes à heure de retrait : plat réservé, cuisine, prête, retrait au comptoir, annulation, plat perdu
begin;
select tests.setup();
select public.today_abidjan() + 1 as d \gset
select (public._service_window(:'d'::date, 'lunch')).starts as starts \gset
select tests.login('alice');
select public.set_pin('2580');
select public.simulate_recharge(20000);

-- Créneaux du déjeuner de demain : 11h30 → 14h15 par 15 min
select tests.eq(jsonb_array_length(public.order_slots(:'d', 'lunch')), 12, '12 créneaux de 15 min au déjeuner');

-- Commande : Attiéké (2 500) + dessert, retrait 12h30
select public.place_order(tests.item('attieke_lunch'), :'starts'::timestamptz + interval '1 hour', array[tests.extra('dessert')]) as r \gset
select tests.ok((:'r'::jsonb ->> 'ok')::boolean, 'commande passée');
select (:'r'::jsonb ->> 'ticket_id')::uuid as o1 \gset
select tests.eq((:'r'::jsonb ->> 'total')::int, 2500 + 500, 'prix du plat + dessert');
select tests.eq((:'r'::jsonb ->> 'order_no')::int, 1, 'commande n° 1 du jour');
select tests.eq((select balance from public.wallets where user_id = tests.uid('alice')), 20000 - 3000, 'compte débité');
select tests.as_service();
select tests.eq((select sold_qty from public.menu_items where id = tests.item('attieke_lunch')), 1, 'portion réservée');
select tests.eq((select count(*) from public.notifications n join public.profiles p on p.id = n.user_id
                  where n.type = 'order_new' and p.role = 'chef')::int, 1, 'la cuisine est prévenue');

-- Règles de créneau
select tests.login('bob');
select public.set_pin('7391');
select public.simulate_recharge(10000);
select tests.code(public.place_order(tests.item('garba_lunch'), :'starts'::timestamptz + interval '7 minutes'), 'INVALID_SLOT', 'hors pas de 15 min : refusé');
select tests.code(public.place_order(tests.item('garba_lunch'), :'starts'::timestamptz + interval '4 hours'), 'INVALID_SLOT', 'après la fin du service : refusé');
select tests.code(public.place_order(tests.item('garba_lunch'), now() + interval '5 minutes'), 'INVALID_SLOT', 'autre jour que le plat : refusé');
-- Attiéké : 2 portions prévues, 1 réservée → la 2e passe, la 3e est refusée
select tests.ok((public.place_order(tests.item('attieke_lunch'), :'starts'::timestamptz + interval '1 hour') ->> 'ok')::boolean, 'dernière portion réservée');
select tests.login('alice');
select tests.code(public.place_order(tests.item('attieke_lunch'), :'starts'::timestamptz), 'SOLD_OUT', 'plat épuisé par les commandes');

-- Créneau complet
select tests.as_service();
update public.settings set value = jsonb_set(value, '{slot_capacity}', '2') where key = 'orders';
select tests.login('alice');
select tests.code(public.place_order(tests.item('garba_lunch'), :'starts'::timestamptz + interval '1 hour'), 'SLOT_FULL', 'créneau complet');
select tests.eq((select (s ->> 'left')::int from jsonb_array_elements(public.order_slots(:'d', 'lunch')) s
                  where (s ->> 'at')::timestamptz = :'starts'::timestamptz + interval '1 hour'), 0, 'créneau affiché complet');
select tests.as_service();
update public.settings set value = jsonb_set(value, '{slot_capacity}', '30') where key = 'orders';

-- Cuisine : un client ne voit ni ne change rien
select tests.login('alice');
select tests.code(public.kitchen_orders(:'d'), 'FORBIDDEN', 'client : écran cuisine interdit');
select tests.code(public.set_order_status(:'o1', 'ready'), 'FORBIDDEN', 'client : statut interdit');
select tests.login('chef');
select tests.eq(jsonb_array_length(public.kitchen_orders(:'d') -> 'orders'), 2, 'le chef voit les 2 commandes de demain');
select tests.ok((public.set_order_status(:'o1', 'preparing') ->> 'ok')::boolean, 'en préparation');

-- Annulation impossible une fois en préparation
select tests.login('alice');
select tests.code(public.cancel_ticket(:'o1'), 'NOT_CANCELLABLE', 'déjà en préparation : pas d''annulation');

select tests.login('chef');
select tests.ok((public.set_order_status(:'o1', 'ready') ->> 'ok')::boolean, 'prête');
select tests.as_service();
select tests.eq((select count(*) from public.notifications where user_id = tests.uid('alice') and type = 'order_ready')::int, 1, 'client prévenu : commande prête');

-- Comptoir : pas le bon jour → refusé ; le jour J → plat enregistré tout seul
select qr_nonce as n1 from public.tickets where id = :'o1' \gset
select tests.code(public.redeem_ticket(:'o1', :'n1', tests.uid('agent'), public.today_abidjan(), 'lunch'), 'WRONG_DAY', 'commande de demain refusée aujourd''hui');
select public.redeem_ticket(:'o1', :'n1', tests.uid('agent'), :'d', 'lunch') as s \gset
select tests.ok((:'s'::jsonb ->> 'ok')::boolean, 'commande prête récupérée (même un peu en avance)');
select tests.eq(:'s'::jsonb -> 'order' ->> 'dish', 'Attiéké poisson braisé', 'l''agent voit le plat commandé');
select tests.eq(jsonb_array_length(:'s'::jsonb -> 'dishes'), 0, 'pas de choix de plat pour une commande');
select tests.eq((select served_qty from public.menu_items where id = tests.item('attieke_lunch')), 1, 'portion comptée servie');
select tests.ok((select dish_id is not null from public.tickets where id = :'o1'), 'plat enregistré sur le ticket');

-- Annulation avant 10h : remboursée, portion libérée
select tests.login('alice');
select public.place_order(tests.item('garba_lunch'), :'starts'::timestamptz + interval '2 hours') ->> 'ticket_id' as o2 \gset
select balance as before from public.wallets where user_id = tests.uid('alice') \gset
select tests.ok((public.cancel_ticket(:'o2') ->> 'ok')::boolean, 'annulation avant l''heure limite');
select tests.eq((select balance from public.wallets where user_id = tests.uid('alice')), :before + 1500, 'remboursée');

-- Pas trop tôt au comptoir
select public.place_order(tests.item('garba_lunch'), :'starts'::timestamptz + interval '2 hours') ->> 'ticket_id' as o3 \gset
select tests.as_service();
select qr_nonce as n3 from public.tickets where id = :'o3' \gset
select tests.code(public.redeem_ticket(:'o3', :'n3', tests.uid('agent'), :'d', 'lunch'), 'TOO_EARLY', 'commande pas prête et créneau pas atteint');

-- Non récupérée à la fin du service : plat perdu, pas de remboursement
select balance as before from public.wallets where user_id = tests.uid('alice') \gset
update public.tickets set valid_until = now() - interval '1 second' where id = :'o3';
select public.expire_tickets();
select tests.eq((select status::text from public.tickets where id = :'o3'), 'expired', 'commande expirée');
select tests.eq((select balance from public.wallets where user_id = tests.uid('alice')), :before, 'pas de remboursement (plat perdu)');
select tests.eq((select count(*) from public.notifications where user_id = tests.uid('alice') and type = 'order_missed')::int, 1, 'client prévenu : non récupérée');

-- Sans téléphone : la commande du jour passe avant les tickets normaux
select tests.login('bob');
select public.purchase_tickets('lunch', 1) as x \gset
select tests.as_service();
update public.tickets set pickup_at = now() - interval '5 minutes', prep_status = 'ready'
 where user_id = tests.uid('bob') and pickup_at is not null;
select short_code as bob_code from public.profiles where id = tests.uid('bob') \gset
select tests.login('agent');
select public.redeem_with_pin(:'bob_code', '7391', public.today_abidjan(), 'lunch') as p \gset
select tests.ok((:'p'::jsonb -> 'order') is not null, 'code PIN au comptoir : la commande est servie en premier');
select tests.check_ledger();
rollback;
