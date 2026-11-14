-- Jean (WhatsApp) : liaison par code, demandes de commande confirmées par PIN, téléphone perdu, rappel 35 min
begin;
select tests.setup();
select public.today_abidjan() + 1 as d \gset
select (public._service_window(:'d'::date, 'lunch')).starts as starts \gset

select tests.login('alice');
select public.set_pin('2580');
select public.simulate_recharge(20000);
select public.whatsapp_link_start() ->> 'code' as code \gset
select tests.ok(length(:'code') = 6, 'code de liaison à 6 chiffres');
select tests.throws($$select * from public.whatsapp_link_codes$$, 'les codes ne sont pas lisibles depuis l''appli');

-- Un client ne peut pas lier un numéro lui-même
select tests.throws($$select public._whatsapp_link_claim('+2250700000000', '000000')$$, 'liaison réservée au serveur');

select tests.as_service();
select tests.code(public._whatsapp_link_claim('+2250700000001', case when :'code' = '000000' then '111111' else '000000' end), 'BAD_CODE', 'mauvais code refusé');
select tests.ok((public._whatsapp_link_claim('+2250700000001', :'code') ->> 'ok')::boolean, 'bon code : numéro lié');
select tests.code(public._whatsapp_link_claim('+2250700000002', :'code'), 'BAD_CODE', 'code à usage unique');
select tests.eq((select user_id from public.whatsapp_links where phone = '+2250700000001'), tests.uid('alice'), 'numéro lié au bon compte');
-- 5 essais faux par heure au plus
select public._whatsapp_link_claim('+2250799999999', '000001'), public._whatsapp_link_claim('+2250799999999', '000002'),
       public._whatsapp_link_claim('+2250799999999', '000003'), public._whatsapp_link_claim('+2250799999999', '000004'),
       public._whatsapp_link_claim('+2250799999999', '000006');
select tests.code(public._whatsapp_link_claim('+2250799999999', '000005'), 'THROTTLED', 'essais en série bloqués');

-- Demande de commande préparée par Jean, confirmée dans l'appli avec le PIN
insert into public.order_requests (user_id, menu_item_id, pickup_at) values (tests.uid('alice'), tests.item('garba_lunch'), :'starts'::timestamptz + interval '1 hour')
  returning token as t \gset
select tests.login('bob');
select tests.code(public.confirm_order_request(:'t', '2580'), 'NOT_FOUND', 'un autre compte ne peut pas confirmer');
select tests.login('alice');
select tests.code(public.confirm_order_request(:'t', '0000'), 'PIN_INVALID', 'mauvais PIN : refusé');
select tests.ok((public.confirm_order_request(:'t', '2580') ->> 'ok')::boolean, 'confirmée avec le PIN : commande passée');
select tests.ok((public.confirm_order_request(:'t', '2580') ->> 'already')::boolean, 'pas de double commande');
select tests.eq((select count(*) from public.tickets where user_id = tests.uid('alice') and pickup_at is not null)::int, 1, 'une seule commande créée');

-- Demande expirée
select tests.as_service();
insert into public.order_requests (user_id, menu_item_id, pickup_at, expires_at) values (tests.uid('alice'), tests.item('garba_lunch'), :'starts'::timestamptz + interval '2 hours', now() - interval '1 minute')
  returning token as t2 \gset
select tests.login('alice');
select tests.code(public.confirm_order_request(:'t2', '2580'), 'EXPIRED', 'demande expirée refusée');

-- Rappel 35 min avant la fin du service
select tests.as_service();
update public.tickets set pickup_at = now(), valid_until = now() + interval '30 minutes'
 where user_id = tests.uid('alice') and pickup_at is not null;
select tests.eq(public.remind_order_pickups(), 1, 'rappel envoyé 35 min avant la fin');
select tests.eq(public.remind_order_pickups(), 0, 'une seule fois');
select tests.ok(exists (select 1 from public.notifications where user_id = tests.uid('alice') and type = 'order_pickup_reminder' and body like '%Garba%'), 'le rappel nomme le plat');

-- Téléphone perdu : WhatsApp délié
select tests.login('alice');
select public.secure_my_devices();
select tests.as_service();
select tests.eq((select count(*) from public.whatsapp_links where user_id = tests.uid('alice'))::int, 0, 'téléphone perdu : WhatsApp délié');
select tests.check_ledger();
rollback;
