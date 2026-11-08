-- Manger sans téléphone : validation au comptoir avec le code PIN, et téléphone perdu
begin;
select tests.setup();
select public.today_abidjan() + 1 as d \gset

select tests.login('alice');
select public.set_pin('2580');
select public.simulate_recharge(20000);
select (public.purchase_tickets('lunch', 2) -> 'ticket_ids' ->> 0) as t1 \gset
select tests.as_service();
select short_code as code from public.profiles where id = tests.uid('alice') \gset

-- Recherche
select tests.login('alice');
select tests.code(public.counter_lookup('Alice', 'lunch'), 'FORBIDDEN', 'un client ne peut pas chercher au comptoir');
select tests.login('agent');
select tests.eq(jsonb_array_length(public.counter_lookup('ali', 'lunch') -> 'results'), 1, 'recherche par nom (3 lettres)');
select tests.eq((public.counter_lookup(replace(:'code', 'DB-', ''), 'lunch') -> 'results' -> 0 ->> 'tickets')::int, 2,
                'recherche par code sans « DB- » : 2 tickets Déjeuner');
select tests.eq(jsonb_array_length(public.counter_lookup('%%%', 'lunch') -> 'results'), 0, 'les jokers SQL ne listent pas tout le monde');
select tests.eq(jsonb_array_length(public.counter_lookup('al', 'lunch') -> 'results'), 0, 'moins de 3 caractères : rien');

-- Mauvais service : aucun essai de PIN consommé
select tests.code(public.redeem_with_pin(:'code', '0000', :'d', 'dinner'), 'NO_TICKET', 'pas de ticket Dîner');
select tests.as_service();
select tests.eq((select pin_failed_attempts from public.profiles where id = tests.uid('alice')), 0, 'aucun essai consommé sans ticket');

-- PIN faux puis bon
select tests.login('agent');
select tests.ok((public.redeem_with_pin(:'code', '1111', :'d', 'lunch') ->> 'attempts_left')::int = 2, 'PIN faux : 2 essais restants');
select public.redeem_with_pin(:'code', '2580', :'d', 'lunch') as r \gset
select tests.ok((:'r'::jsonb ->> 'ok')::boolean and :'r'::jsonb ->> 'method' = 'pin', 'bon PIN : ticket validé sans QR');
select tests.ok((:'r'::jsonb -> 'dishes') is not null, 'l''agent peut choisir le plat comme après un scan');
select tests.eq((:'r'::jsonb ->> 'remaining')::int, 1, 'il reste 1 ticket Déjeuner');
select tests.as_service();
select tests.eq((select redeem_method from public.tickets where id = (:'r'::jsonb ->> 'ticket_id')::uuid), 'pin', 'ticket marqué « sans QR »');
select tests.ok(exists (select 1 from public.notifications where user_id = tests.uid('alice') and type = 'ticket_pin'), 'client prévenu de la validation sans QR');
select tests.eq((select pin_failed_attempts from public.profiles where id = tests.uid('alice')), 0, 'essais remis à zéro après le bon PIN');

-- 3 PIN faux : blocage + alerte client
select tests.login('agent');
select public.redeem_with_pin(:'code', '1111', :'d', 'lunch');
select public.redeem_with_pin(:'code', '1112', :'d', 'lunch');
select tests.code(public.redeem_with_pin(:'code', '1113', :'d', 'lunch'), 'PIN_LOCKED', '3 erreurs : PIN bloqué');
select tests.code(public.redeem_with_pin(:'code', '2580', :'d', 'lunch'), 'PIN_LOCKED', 'même le bon PIN est refusé pendant le blocage');
select tests.as_service();
select tests.ok(exists (select 1 from public.notifications where user_id = tests.uid('alice') and type = 'pin_alert'), 'client alerté des essais');

-- Agent qui enchaîne les essais sur plusieurs comptes
insert into public.audit_log (actor_id, action, target) select tests.uid('agent'), 'counter_pin_failed', 'x' from generate_series(1, 10);
select tests.login('agent');
select tests.code(public.redeem_with_pin(:'code', '2580', :'d', 'lunch'), 'AGENT_THROTTLED', '10 PIN faux en 1 h : scanner bloqué sur ce mode');
select tests.login('alice');
select tests.code(public.redeem_with_pin(:'code', '2580', :'d', 'lunch'), 'FORBIDDEN', 'un client ne peut pas valider');

-- Téléphone perdu : les QR gardés hors ligne ne passent plus
select tests.as_service();
update public.profiles set pin_locked_until = null where id = tests.uid('alice');
select id as t2, qr_nonce as old_nonce from public.tickets where user_id = tests.uid('alice') and status = 'valid' limit 1 \gset
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  (tests.uid('alice'), 'https://push.test/ancien', 'k', 'a'), (tests.uid('alice'), 'https://push.test/nouveau', 'k', 'a');
select tests.login('alice');
select tests.ok((public.secure_my_devices('https://push.test/nouveau') ->> 'ok')::boolean, 'Profil : « j''ai perdu mon téléphone »');
select tests.as_service();
select tests.code(public.redeem_ticket(:'t2', :'old_nonce', tests.uid('agent2'), :'d', 'lunch'), 'INVALID_QR', 'ancien QR (hors ligne) refusé');
select tests.eq((select array_agg(endpoint) from public.push_subscriptions where user_id = tests.uid('alice')), array['https://push.test/nouveau'],
                'notifications retirées de l''ancien téléphone, gardées sur le nouveau');
select tests.ok((select qr_nonce from public.tickets where id = :'t2') <> :'old_nonce', 'le ticket reste valide avec un nouveau QR');
select tests.check_ledger();
rollback;
