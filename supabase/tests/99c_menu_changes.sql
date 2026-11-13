-- Menu modifié en cours de semaine : une seule notification groupée aux clients, après 2 min de calme
begin;
select tests.setup();
select tests.as_service();
select count(*) as before from public.notifications where type = 'menu_changed' \gset

-- Le chef retire le Garba du déjeuner, met l'Attiéké épuisé au dîner et change le prix du VIP
select tests.login('chef');
delete from public.menu_items where id = tests.item('garba_lunch');
update public.menu_items set is_sold_out = true where id = tests.item('attieke_dinner');
update public.menu_items set price = 5500 where id = tests.item('vip_dinner');
update public.menu_items set planned_qty = 60 where id = tests.item('attieke_dinner');   -- quantité prévue : pas une info client
select tests.as_service();
select tests.eq((select count(*) from public.menu_changes where sent_at is null)::int, 3, '3 changements visibles enregistrés (pas la quantité prévue)');

-- Le chef vient de modifier : on attend
select tests.eq(public.send_menu_changes(), 0, 'rien envoyé tant que le chef modifie encore');
select tests.eq((select count(*) from public.notifications where type = 'menu_changed')::int, :before, 'aucune notification pendant les modifications');

-- 2 min plus tard : une seule notification par client, qui ouvre le menu
update public.menu_changes set created_at = now() - interval '3 minutes';
select tests.eq(public.send_menu_changes(), 2, 'deux services modifiés regroupés');
select tests.eq((select count(*) from public.notifications n join public.profiles p on p.id = n.user_id
                  where n.type = 'menu_changed' and p.role = 'client')::int,
                (select count(*) from public.profiles where role = 'client' and not is_blocked)::int, 'chaque client reçoit UNE notification');
select tests.eq((select count(*) from public.notifications n join public.profiles p on p.id = n.user_id
                  where n.type = 'menu_changed' and p.role <> 'client')::int, 0, 'le personnel ne la reçoit pas');
select tests.ok((select body from public.notifications where type = 'menu_changed' limit 1) like '%Retiré : Garba%Épuisé : Attiéké%', 'le message dit ce qui change');
select tests.eq((select data ->> 'href' from public.notifications where type = 'menu_changed' limit 1), '/app/menu', 'la notification ouvre le menu');
select tests.eq(public.send_menu_changes(), 0, 'pas de doublon au passage suivant');

-- Un seul service : titre précis
select tests.login('chef');
update public.menu_items set is_sold_out = false where id = tests.item('attieke_dinner');
select tests.as_service();
update public.menu_changes set created_at = now() - interval '3 minutes';
select tests.eq(public.send_menu_changes(), 1, 'un service modifié');
select tests.eq((select count(*) from public.notifications where type = 'menu_changed' and title = 'Menu modifié : Dîner demain 🍽️' and body = 'De retour : Attiéké poisson braisé')::int, (select count(*) from public.profiles where role = 'client' and not is_blocked)::int, 'titre : service et jour');

-- Ajouté puis retiré dans la foulée : rien
select tests.login('chef');
insert into public.menu_items (menu_id, service_date, service, dish_id, price)
  select menu_id, service_date, 'lunch', (select id from public.dishes where name = 'Plateau VIP'), 6000
    from public.menu_items where id = tests.item('attieke_lunch') returning id as tmp \gset
delete from public.menu_items where id = :'tmp';
select tests.as_service();
update public.menu_changes set created_at = now() - interval '3 minutes';
select tests.eq(public.send_menu_changes(), 0, 'ajout annulé aussitôt : aucune notification');

-- Brouillon : jamais de notification
select tests.login('chef');
insert into public.menus (week_start) values (date_trunc('week', public.today_abidjan() + 14)::date) returning id as m \gset
insert into public.menu_items (menu_id, service_date, service, dish_id, price)
  select :'m', date_trunc('week', public.today_abidjan() + 14)::date, 'lunch', id, 1000 from public.dishes limit 1;
select tests.as_service();
select tests.eq((select count(*) from public.menu_changes where sent_at is null)::int, 0, 'menu brouillon : rien enregistré');

-- Un client ne lit pas le journal des changements
select tests.login('alice');
select tests.throws($$select * from public.menu_changes$$, 'journal interne illisible par les clients');
rollback;
