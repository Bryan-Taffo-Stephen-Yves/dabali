-- Suppléments en quantité : 10 tickets → jusqu'à 10 desserts (et 10 entrées), au choix par article
begin;
select tests.setup();
select tests.login('alice');
select public.set_pin('2580');
select public.simulate_recharge(100000);
select id as fruits from public.extras where name = 'Salade de fruits' \gset
select id as crudites from public.extras where name = 'Salade de crudités' \gset
select tests.as_service();
insert into public.extras (name, price, kind) values ('Yaourt', 400, 'dessert') returning id as yaourt \gset
select tests.login('alice');

-- 4 tickets Déjeuner : 3 Salade de fruits + 1 Yaourt, 2 entrées
select public.purchase_tickets('lunch', 4, '{}', '2580', null, false,
  jsonb_build_array(jsonb_build_object('id', :'fruits', 'qty', 3), jsonb_build_object('id', :'yaourt', 'qty', 1),
                    jsonb_build_object('id', :'crudites', 'qty', 2))) as r \gset
select tests.ok((:'r'::jsonb ->> 'ok')::boolean, 'achat de 4 tickets avec desserts et entrées en quantité');
select tests.eq((:'r'::jsonb ->> 'total')::int, 4 * 2500 + 3 * 500 + 400 + 2 * 500, 'total = tickets + chaque supplément choisi');
select tests.as_service();
select tests.eq((select count(*) from public.tickets t, jsonb_array_elements(t.extras) e
                  where t.id in (select (jsonb_array_elements_text(:'r'::jsonb -> 'ticket_ids'))::uuid) and e ->> 'kind' = 'dessert')::int,
                4, '4 desserts répartis sur les 4 tickets');
select tests.eq((select max(jsonb_array_length(extras)) from public.tickets
                  where id in (select (jsonb_array_elements_text(:'r'::jsonb -> 'ticket_ids'))::uuid)), 2,
                'au plus une entrée et un dessert par ticket');
select tests.eq((select sum(total) from public.tickets
                  where id in (select (jsonb_array_elements_text(:'r'::jsonb -> 'ticket_ids'))::uuid))::int,
                (:'r'::jsonb ->> 'total')::int, 'la somme des tickets = le montant payé (remboursements justes)');
select tests.ok((select note from public.transactions where user_id = tests.uid('alice') and type = 'purchase' order by created_at desc limit 1)
                like '4 × ticket Déjeuner + %3 Salade de fruits%', 'libellé avec les quantités');

-- Plus de desserts que de tickets : refusé
select tests.login('alice');
select tests.code(public.purchase_tickets('lunch', 2, '{}', '2580', null, false,
  jsonb_build_array(jsonb_build_object('id', :'fruits', 'qty', 2), jsonb_build_object('id', :'yaourt', 'qty', 1))),
  'INVALID_EXTRA', '3 desserts pour 2 tickets : refusé');
-- Supplément au petit-déjeuner : refusé
select tests.code(public.purchase_tickets('breakfast', 1, '{}', null, null, false,
  jsonb_build_array(jsonb_build_object('id', :'fruits', 'qty', 1))), 'EXTRAS_NOT_ALLOWED', 'pas de dessert au petit-déjeuner');
-- Ancienne forme toujours acceptée : le même dessert sur chaque ticket
select public.purchase_tickets('lunch', 2, array[:'fruits']::uuid[], '2580') as r2 \gset
select tests.eq((:'r2'::jsonb ->> 'total')::int, 2 * 3000, 'ancienne forme : dessert sur chaque ticket');
select tests.check_ledger();
rollback;
