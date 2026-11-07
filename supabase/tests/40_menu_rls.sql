-- Menus (statuts, date limite), RLS du catalogue et des profils
begin;
select tests.setup();

-- ── Lecture publique ──
select tests.as_anon();
select tests.eq((select count(*) from public.menu_items)::int, 5, 'anonyme : voit le menu publié');
select tests.ok((select count(*) from public.dishes) = 3, 'anonyme : voit les plats');
select tests.throws($$select * from public.wallets$$, 'anonyme : aucun accès aux portefeuilles');
select tests.throws($$select id from public.profiles$$, 'anonyme : aucun accès aux profils');

-- ── Brouillon invisible aux clients ──
select tests.login('chef');
insert into public.menus (week_start) values (date_trunc('week', public.today_abidjan() + 14)::date);
select id as m_next from public.menus where status = 'draft' \gset
insert into public.menu_items (menu_id, service_date, service, dish_id, price, planned_qty)
select :'m_next', date_trunc('week', public.today_abidjan() + 14)::date, 'lunch', id, base_price, 40 from public.dishes;
select tests.throws(format($$insert into public.menu_items (menu_id, service_date, service, dish_id, price)
                             select %L, current_date - 30, 'lunch', id, 100 from public.dishes limit 1$$, :'m_next'),
                    'date hors de la semaine du menu refusée');
select tests.throws(format($$update public.menus set status = 'published' where id = %L$$, :'m_next'),
                    'chef : statut modifiable uniquement via RPC');
select tests.throws($$update public.menu_items set sold_qty = 0$$, 'chef : sold_qty non modifiable');

select tests.login('alice');
select tests.eq((select count(*) from public.menus where id = :'m_next')::int, 0, 'client : brouillon invisible');
select tests.throws($$insert into public.menus (week_start) values ('2030-01-07')$$, 'client : création de menu interdite');
select tests.throws($$insert into public.dishes (name, base_price) values ('Burger', 100)$$, 'client : création de plat interdite');
select tests.code(public.submit_menu(:'m_next'), 'FORBIDDEN', 'client : soumission interdite');

-- ── Soumission / publication ──
select tests.login('chef');
select tests.ok((public.submit_menu(:'m_next') ->> 'ok')::boolean, 'chef soumet le menu');
select tests.code(public.submit_menu(:'m_next'), 'INVALID_STATUS', 'double soumission refusée');
select tests.ok((public.publish_menu(:'m_next') ->> 'ok')::boolean, 'chef publie avant la date limite');
select tests.login('alice');
select tests.ok(exists (select 1 from public.notifications where type = 'menu_published'), 'clients notifiés de la publication');

-- Menu en retard (semaine en cours, date limite dépassée)
select tests.logout();
insert into public.menus (week_start) values (date_trunc('week', public.today_abidjan() - 7)::date) returning id as m_late \gset
insert into public.menu_items (menu_id, service_date, service, dish_id, price)
select :'m_late', date_trunc('week', public.today_abidjan() - 7)::date, 'dinner', id, base_price from public.dishes limit 1;
select tests.login('chef');
select tests.code(public.publish_menu(:'m_late'), 'DEADLINE_PASSED', 'chef : publication après la date limite refusée');
select tests.login('admin');
select tests.ok((public.publish_menu(:'m_late') ->> 'ok')::boolean, 'admin : publication après la date limite autorisée');

-- ── Date limite : mercredi 23h59 ──
select tests.eq(public.menu_deadline('2030-01-07'), '2030-01-02 23:59:59+00'::timestamptz, 'date limite semaine du 07/01/2030 = mer. 02/01 23h59');
select tests.logout();
select tests.as_service();
select tests.ok((public.check_menu_deadlines('2030-01-01 09:00+00') ->> 'reminded')::boolean, 'mardi : rappel au chef');
select tests.ok(not (public.check_menu_deadlines('2030-01-01 10:00+00') ->> 'reminded')::boolean, 'rappel envoyé une seule fois');
select tests.ok(not (public.check_menu_deadlines('2030-01-02 23:00+00') ->> 'alerted')::boolean, 'mercredi 23h : pas encore d''alerte');
select tests.ok((public.check_menu_deadlines('2030-01-03 00:05+00') ->> 'alerted')::boolean, 'jeudi 00h05 : alerte admin (menu non soumis)');
select tests.ok(not (public.check_menu_deadlines('2030-01-03 01:05+00') ->> 'alerted')::boolean, 'alerte envoyée une seule fois');
select tests.logout();
select tests.ok(exists (select 1 from public.notifications where user_id = tests.uid('admin') and type = 'menu_deadline_missed'),
                'admin a reçu l''alerte');
select tests.ok(not exists (select 1 from public.notifications where user_id = tests.uid('alice') and type = 'menu_deadline_missed'),
                'les clients ne reçoivent pas l''alerte');

-- ── Profils ──
select tests.login('alice');
select tests.eq((select count(*) from public.profiles)::int, 1, 'client : ne voit que son profil');
update public.profiles set full_name = 'Alice K.' where id = auth.uid();
select tests.eq((select full_name from public.profiles where id = auth.uid()), 'Alice K.', 'client : modifie son nom');
update public.profiles set full_name = 'Piraté' where id = tests.uid('bob');
select tests.logout();
select tests.eq((select full_name from public.profiles where id = tests.uid('bob')), 'Bob Traoré', 'client : ne modifie pas le profil d''un autre');
select tests.ok((select short_code from public.profiles where id = tests.uid('alice')) ~ '^DB-\d{4}$', 'identifiant court DB-XXXX généré');
select tests.eq((select balance from public.wallets where user_id = tests.uid('bob')), 0, 'portefeuille créé à l''inscription');
select tests.eq((select phone from public.profiles where id = tests.uid('alice')), '+2250701020304', 'téléphone enregistré');

select tests.login('alice');
select tests.code(public.admin_set_role(tests.uid('alice'), 'admin'), 'FORBIDDEN', 'client : promotion interdite');
select tests.login('admin');
select tests.ok((public.admin_set_role(tests.uid('bob'), 'agent') ->> 'ok')::boolean, 'admin : change un rôle');
select tests.ok(exists (select 1 from public.audit_log where action = 'set_role'), 'changement de rôle journalisé');

-- Un membre de l'équipe bloqué perd ses droits
select tests.ok((public.set_user_blocked(tests.uid('chef'), true) ->> 'ok')::boolean, 'admin bloque le chef');
select tests.login('chef');
select tests.ok(not public.has_role('chef'), 'chef bloqué : plus de droits');
select tests.login('caisse');
select tests.code(public.set_user_blocked(tests.uid('agent'), true), 'FORBIDDEN', 'caissier : ne bloque pas un membre de l''équipe');

-- ── Stock ──
select tests.login('chef');
select tests.logout();
update public.profiles set is_blocked = false where id = tests.uid('chef');
select tests.login('chef');
insert into public.stock_movements (ingredient_id, type, qty, reason) select id, 'in', 5, 'Achat marché' from public.ingredients;
select tests.eq((select stock_qty from public.ingredients), 15.000::numeric(12,3), 'entrée de stock appliquée');
select tests.eq((public.stock_inventory((select id from public.ingredients), 14.5) ->> 'delta')::numeric, -0.5, 'inventaire : écart enregistré');
select tests.eq((select stock_qty from public.ingredients), 14.500::numeric(12,3), 'stock = quantité comptée');
select tests.throws($$insert into public.stock_movements (ingredient_id, type, qty) select id, 'out', 1 from public.ingredients$$,
                    'chef : les sorties « out » sont réservées au scan');
select tests.login('alice');
select tests.eq((select count(*) from public.ingredients)::int, 0, 'client : stock invisible');

select tests.logout();
rollback;
