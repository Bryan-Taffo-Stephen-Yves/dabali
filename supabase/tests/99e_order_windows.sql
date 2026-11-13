-- Commandes : horaires fixés par la cuisine, pause, PIN obligatoire, limite par repas, notifications de suivi
begin;
select tests.setup();
select public.today_abidjan() + 1 as d \gset
select (public._service_window(:'d'::date, 'lunch')).starts as starts \gset
-- Un plat au menu d'aujourd'hui (pour tester les horaires du jour)
select tests.as_service();
insert into public.menus (week_start, status, published_at) values (date_trunc('week', public.today_abidjan())::date - 7000, 'published', now())
  returning id as m \gset
update public.menus set week_start = date_trunc('week', public.today_abidjan())::date where id = :'m'
  and not exists (select 1 from public.menus where week_start = date_trunc('week', public.today_abidjan())::date);
select id as m from public.menus where week_start = date_trunc('week', public.today_abidjan())::date \gset
insert into public.menu_items (menu_id, service_date, service, dish_id, price)
  select :'m', public.today_abidjan(), 'lunch', id, 1500 from public.dishes where name = 'Garba'
  on conflict do nothing;
select id as today_item from public.menu_items where service_date = public.today_abidjan() and service = 'lunch' limit 1 \gset

select tests.login('alice');
select public.set_pin('2580');
select public.simulate_recharge(20000);

-- PIN obligatoire pour toute commande, même petite
select tests.code(public.place_order(tests.item('garba_lunch'), :'starts'::timestamptz + interval '1 hour'), 'PIN_INVALID', 'commande sans PIN refusée (même 1 500 F)');

-- Horaires du jour fixés par la cuisine
select tests.code(public.set_order_window('lunch', '12:00', '13:00'), 'FORBIDDEN', 'client : ne règle pas les horaires');
select tests.login('chef');
select tests.code(public.set_order_window('lunch', '13:00', '12:00'), 'INVALID_WINDOW', 'fermeture avant ouverture : refusé');
select tests.ok((public.set_order_window('lunch', '00:00', '00:01') ->> 'ok')::boolean, 'le chef règle la plage du déjeuner');
select tests.login('alice');
select tests.code(public.place_order(:'today_item', (public._service_window(public.today_abidjan(), 'lunch')).starts + interval '1 hour', '{}', '2580'),
                  'ORDERS_CLOSED', 'hors de la plage du jour : commandes fermées');
select tests.ok((public.place_order(tests.item('garba_lunch'), :'starts'::timestamptz + interval '1 hour', '{}', '2580') ->> 'ok')::boolean,
                'précommande pour demain : possible en dehors de la plage');
select tests.login('chef');
select public.set_order_window('lunch', '00:00', '23:59');
select tests.login('alice');
select tests.ok(coalesce(public.place_order(:'today_item', (public._service_window(public.today_abidjan(), 'lunch')).starts + interval '1 hour', '{}', '2580') ->> 'code', 'ok') <> 'ORDERS_CLOSED',
                'dans la plage : plus de refus « fermé »');

-- Pause
select tests.login('chef');
select public.set_order_window('lunch', null, null, true);
select tests.login('alice');
select tests.code(public.place_order(tests.item('garba_lunch'), :'starts'::timestamptz + interval '2 hours', '{}', '2580'), 'ORDERS_PAUSED', 'commandes en pause');
select tests.login('chef');
select public.set_order_window('lunch', null, null, false);

-- Au plus 2 commandes en cours par repas
select tests.login('alice');
select tests.ok((public.place_order(tests.item('garba_lunch'), :'starts'::timestamptz + interval '2 hours', '{}', '2580') ->> 'ok')::boolean, '2e commande du repas');
select tests.code(public.place_order(tests.item('garba_lunch'), :'starts'::timestamptz + interval '2 hours', '{}', '2580'), 'TOO_MANY_ORDERS', '3e commande du même repas refusée');

-- Notifications : client (reçue), chef ET agent (nouvelle), client (en préparation)
select tests.as_service();
select tests.ok(exists (select 1 from public.notifications where user_id = tests.uid('alice') and type = 'order_placed'), 'client : « commande bien reçue »');
select tests.ok(exists (select 1 from public.notifications where user_id = tests.uid('agent') and type = 'order_new'), 'agent du comptoir prévenu');
select tests.ok(exists (select 1 from public.notifications where user_id = tests.uid('chef') and type = 'order_new'), 'chef prévenu');
select id as o from public.tickets where user_id = tests.uid('alice') and pickup_at is not null and status = 'valid' limit 1 \gset
select tests.login('chef');
select public.set_order_status(:'o', 'preparing');
select tests.as_service();
select tests.ok(exists (select 1 from public.notifications where user_id = tests.uid('alice') and type = 'order_preparing'), 'client : « la cuisine prépare »');
select tests.check_ledger();
rollback;
