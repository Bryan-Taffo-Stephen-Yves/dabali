-- Prévisions : répartition entre plats selon la popularité (a priori + choix au comptoir)
begin;
select tests.setup();
select public.today_abidjan() + 1 as d \gset

-- Sans historique : la répartition suit la popularité a priori saisie par le chef
select tests.as_service();
update public.dishes set popularity_prior = 1.50 where name = 'Garba';
update public.dishes set popularity_prior = 0.50 where name = 'Attiéké poisson braisé';
select tests.login('chef');
select tests.ok(
  (select (i->>'share')::int from jsonb_array_elements(public.admin_forecast(:'d')->'items') i where i->>'dish' = 'Garba' and i->>'service' = 'lunch') = 75,
  'sans historique : part = popularité a priori (1,5 vs 0,5 → 75 %)');
select tests.ok(
  (select bool_and(i->>'basis' = 'prior') from jsonb_array_elements(public.admin_forecast(:'d')->'items') i),
  'sans historique : base « a priori » signalée');

-- Avec 3 semaines où l'attiéké part 3 fois plus que le garba, l'observé l'emporte progressivement
select tests.as_service();
insert into public.menus (id, week_start, status, published_at)
select gen_random_uuid(), date_trunc('week', :'d'::date - 7 * k)::date, 'published', now() from generate_series(1, 3) k
on conflict (week_start) do nothing;
insert into public.menu_items (menu_id, service_date, service, dish_id, price, planned_qty, sold_qty, served_qty)
select m.id, :'d'::date - 7 * k, 'lunch', d.id, d.base_price, 100,
       case when d.name = 'Attiéké poisson braisé' then 60 else 20 end, case when d.name = 'Attiéké poisson braisé' then 60 else 20 end
  from generate_series(1, 3) k join public.menus m on m.week_start = date_trunc('week', :'d'::date - 7 * k)::date
  cross join public.dishes d where d.name in ('Garba', 'Attiéké poisson braisé');
select tests.login('chef');
select (i->>'share')::int as att_share from jsonb_array_elements(public.admin_forecast(:'d')->'items') i
 where i->>'dish' = 'Attiéké poisson braisé' and i->>'service' = 'lunch' \gset
-- attiéké : (3 × 1,5 + 8 × 0,5) / 11 = 0,77 ; garba : (3 × 0,5 + 8 × 1,5) / 11 = 1,23 → 39 %
select tests.eq(:att_share, 39, 'historique court : mélange observé / a priori');
select tests.ok((select (p->>'observed')::numeric = 1.5 from jsonb_array_elements(public.dish_popularity()) p where p->>'name' = 'Attiéké poisson braisé'),
  'popularité observée = part des choix / part égale');

-- Plat épuisé : demande non servie → majoration de 15 %
select tests.as_service();
update public.menu_items set is_sold_out = true where service = 'lunch' and service_date = :'d'::date - 7
   and dish_id = (select id from public.dishes where name = 'Garba');
select tests.login('chef');
select tests.ok((select (p->>'observed')::numeric > 0.5 from jsonb_array_elements(public.dish_popularity()) p where p->>'name' = 'Garba'),
  'plat épuisé : popularité observée majorée');

select tests.login('alice');
select tests.throws($$select public.dish_popularity()$$, 'client : classement de popularité interdit');
rollback;
