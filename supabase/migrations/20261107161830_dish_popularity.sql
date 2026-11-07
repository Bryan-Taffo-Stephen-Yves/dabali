-- Popularité des plats pour les prévisions.
-- 1. Popularité « a priori » par plat (1 = moyenne), saisie par le chef, initialisée à partir des enquêtes
--    disponibles (attiéké = aliment le plus consommé à Abidjan, garba en forte progression chez les jeunes,
--    alloco très prisé) et du terrain (alloco / frites plébiscités, plats de riz moins demandés).
-- 2. Popularité observée : part des choix au comptoir rapportée à une part égale entre les plats servis
--    (8 dernières semaines, tous services), majorée de 15 % les jours où le plat était épuisé (demande non servie).
-- 3. Mélange bayésien : (jours × observé + 8 × a priori) / (jours + 8), puis petit ajustement selon les avis.
alter table public.dishes add column popularity_prior numeric(3,2) not null default 1.00
  check (popularity_prior between 0.30 and 2.00);
comment on column public.dishes.popularity_prior is 'Popularité de départ (1 = moyenne) utilisée tant que le plat a peu d''historique';

update public.dishes d set popularity_prior = v.p from (values
  ('Alloco poulet braisé', 1.45), ('Attiéké poisson braisé', 1.35), ('Garba', 1.30),
  ('Foutou banane sauce graine', 1.05), ('Placali sauce kplala', 0.80),
  ('Riz sauce arachide poulet', 0.90), ('Riz sauce graine', 0.80), ('Spaghetti sautés', 0.90), ('Salade composée', 0.65),
  ('Pain beurre & café au lait', 1.30), ('Omelette pain', 1.10), ('Bouillie de mil', 0.70),
  ('Crêpes sucrées', 1.25), ('Croque-monsieur', 1.05), ('Brownie', 0.95), ('Pain perdu', 0.90)
) v(name, p) where d.name = v.name;

create or replace function public._dish_popularity(p_date date)
returns table (dish_id uuid, prior numeric, observed numeric, days int, stars numeric, popularity numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with day as (
    select mi.dish_id, mi.served_qty, (mi.is_sold_out or mi.is_full) sold_out,
           sum(mi.served_qty) over (partition by mi.service, mi.service_date) tot,
           count(*) over (partition by mi.service, mi.service_date) n
      from menu_items mi join menus m on m.id = mi.menu_id
     where m.status = 'published' and mi.service_date < least(p_date, current_date) and mi.service_date >= p_date - 56
  ), obs as (
    select day.dish_id, count(*)::int days,
           avg(day.served_qty::numeric / day.tot * day.n * case when day.sold_out then 1.15 else 1 end) observed
      from day where day.tot > 0 group by day.dish_id
  ), rat as (
    select r.dish_id, avg(r.stars) stars, count(*) nb from ratings r where r.created_at >= p_date - 90 group by r.dish_id
  )
  select d.id, d.popularity_prior, round(o.observed, 3), coalesce(o.days, 0), round(r.stars, 2),
         ((coalesce(o.days, 0) * coalesce(o.observed, 0) + 8 * d.popularity_prior) / (coalesce(o.days, 0) + 8))
         * case when r.nb >= 10 then 1 + greatest(least((r.stars - 4.2) * 0.15, 0.1), -0.15) else 1 end
    from dishes d left join obs o on o.dish_id = d.id left join rat r on r.dish_id = d.id
$$;
revoke all on function public._dish_popularity(date) from public, anon, authenticated;

-- Classement lisible par l'équipe (page Plats / Prévisions)
create or replace function public.dish_popularity() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role('chef') then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('dish_id', p.dish_id, 'name', d.name, 'popularity', round(p.popularity, 2),
            'observed', round(p.observed, 2), 'days', p.days, 'stars', p.stars, 'prior', p.prior) order by p.popularity desc), '[]')
            from public._dish_popularity(current_date) p join dishes d on d.id = p.dish_id where d.is_active);
end $$;
revoke all on function public.dish_popularity() from public, anon;
grant execute on function public.dish_popularity() to authenticated;

create or replace function public.admin_forecast(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not public.has_role('chef') then raise exception 'forbidden' using errcode = '42501'; end if;
  with svc as (
    select s.svc, s.o, w.starts_at, w.ends_at,
      (select avg(c)::numeric from (
          select (select count(*) from tickets t where t.service_date = h and t.service = s.svc and t.status = 'used') c
            from unnest(array[p_date - 7, p_date - 14, p_date - 21, p_date - 28]) h
           where public._service_on_menu(h, s.svc)) z) hist,
      (select count(*) from tickets t where t.service = s.svc and t.status = 'valid'
          and t.valid_until > w.starts_at and t.valid_from < w.ends_at) outstanding
      from unnest(enum_range(null::public.service_kind)) with ordinality s(svc, o)
      cross join lateral public.service_window(p_date, s.svc) w
     where exists (select 1 from menu_items mi join menus m on m.id = mi.menu_id
                    where mi.service_date = p_date and mi.service = s.svc)
  ), svc2 as (
    select *, greatest(round(coalesce(hist, 0)), outstanding)::int expected_total,
           case when hist is not null then 'history' else 'tickets' end basis from svc
  ), items as (
    select mi.id, mi.service, mi.dish_id, d.name, mi.planned_qty, mi.prepared_qty, mi.served_qty,
           p.popularity, p.observed, p.days, p.stars, p.prior
      from menu_items mi join menus m on m.id = mi.menu_id join dishes d on d.id = mi.dish_id
      join public._dish_popularity(p_date) p on p.dish_id = mi.dish_id
     where mi.service_date = p_date
  ), shares as (
    select i.*, s.expected_total, s.basis,
           i.popularity / sum(i.popularity) over (partition by i.service) share
      from items i join svc2 s on s.svc = i.service
  ), rec as (
    select *, round(expected_total * share)::int expected, ceil(expected_total * share * 1.05)::int recommended from shares
  ), needs as (
    select ing.id, ing.name, ing.unit, ing.stock_qty, ing.alert_threshold, ing.unit_cost,
           round(sum(rl.qty_per_portion * rec.recommended), 2) need
      from rec join recipe_lines rl on rl.dish_id = rec.dish_id join ingredients ing on ing.id = rl.ingredient_id
     group by ing.id
  )
  select jsonb_build_object(
    'date', p_date,
    'services', (select coalesce(jsonb_agg(jsonb_build_object('service', svc, 'label', public.service_label(svc),
                   'history', round(hist), 'outstanding', outstanding, 'expected', expected_total, 'basis', basis) order by o), '[]') from svc2),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', id, 'service', service, 'dish', name, 'planned', planned_qty, 'prepared', prepared_qty,
                'served', served_qty, 'share', round(share * 100), 'expected', expected, 'recommended', recommended,
                'popularity', round(popularity, 2), 'observed', round(observed, 2), 'days', days, 'stars', stars, 'prior', prior,
                'basis', case when days >= 5 then 'dish' else 'prior' end)
                order by service, recommended desc), '[]') from rec),
    'ingredients', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', id, 'name', name, 'unit', unit, 'stock', stock_qty, 'need', need,
                'to_buy', greatest(round(need - stock_qty + alert_threshold, 2), 0),
                'cost', ceil(greatest(need - stock_qty + alert_threshold, 0) * unit_cost)) order by name), '[]') from needs)
  ) into r;
  return r;
end $$;

