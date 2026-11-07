-- Dabali — agrégats du dashboard (§6). Lecture seule, réservés à l'équipe.

-- ───────────── Vue d'ensemble (§6.1) ─────────────
create or replace function public.admin_overview(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d date := coalesce(p_date, public.today_abidjan());
  d0 timestamptz := d::timestamp at time zone 'Africa/Abidjan';
  d1 timestamptz := (d + 1)::timestamp at time zone 'Africa/Abidjan';
  r jsonb;
begin
  if not public.has_role('caissier', 'chef') then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'date', d,
    'revenue', coalesce((select -sum(amount) from transactions where type in ('purchase', 'refund') and created_at >= d0 and created_at < d1), 0),
    'recharges', coalesce((select sum(amount) from transactions where type in ('recharge', 'recharge_cash') and created_at >= d0 and created_at < d1), 0),
    'recharges_cash', coalesce((select sum(amount) from transactions where type = 'recharge_cash' and created_at >= d0 and created_at < d1), 0),
    'sold', (select count(*) from tickets where service_date = d and status <> 'cancelled'),
    'served', (select count(*) from tickets where service_date = d and status = 'used'),
    'expired', (select count(*) from tickets where service_date = d and (status = 'expired' or (status = 'valid' and valid_until <= now()))),
    'avg_basket', coalesce((select round(avg(total)) from tickets where service_date = d and status <> 'cancelled'), 0),
    'sold_out', (select count(*) from menu_items mi join menus m on m.id = mi.menu_id
                  where m.status = 'published' and mi.service_date = d and (mi.is_sold_out or mi.is_full)),
    'occupancy', public.occupancy_now(),
    'by_hour', (select coalesce(jsonb_agg(jsonb_build_object('h', h, 'sales', coalesce(s.n, 0), 'scans', coalesce(sc.n, 0)) order by h), '[]')
                  from generate_series(6, 22) h
                  left join (select extract(hour from created_at at time zone 'Africa/Abidjan')::int hh, count(*) n
                               from transactions where type = 'purchase' and created_at >= d0 and created_at < d1 group by 1) s on s.hh = h
                  left join (select extract(hour from used_at at time zone 'Africa/Abidjan')::int hh, count(*) n
                               from tickets where used_at >= d0 and used_at < d1 group by 1) sc on sc.hh = h),
    'top_dishes', (select coalesce(jsonb_agg(x order by x.sold desc), '[]') from (
                    select d2.name, d2.photo_url, count(*)::int sold
                      from tickets t join dishes d2 on d2.id = t.dish_id
                     where t.service_date between d - 6 and d and t.status <> 'cancelled'
                     group by d2.id order by 3 desc limit 5) x),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('service', s.service, 'sold', s.sold, 'served', s.served, 'planned', s.planned) order by s.service), '[]')
                   from (select mi.service, sum(mi.sold_qty)::int sold, sum(mi.served_qty)::int served, sum(mi.planned_qty)::int planned
                           from menu_items mi join menus m on m.id = mi.menu_id
                          where m.status = 'published' and mi.service_date = d group by 1) s),
    'alerts', (
      select coalesce(jsonb_agg(a), '[]') from (
        select jsonb_build_object('kind', 'stock', 'level', 'warn', 'text', 'Stock bas : ' || name || ' (' || trim(to_char(stock_qty, 'FM999990.##')) || ' ' || unit || ')') a
          from ingredients where stock_qty < alert_threshold
        union all
        select jsonb_build_object('kind', 'sold_out', 'level', 'err', 'text', 'Rupture : ' || d2.name || ' (' || case mi.service when 'lunch' then 'déjeuner' else 'dîner' end || ')')
          from menu_items mi join dishes d2 on d2.id = mi.dish_id join menus m on m.id = mi.menu_id
         where m.status = 'published' and mi.service_date = d and (mi.is_sold_out or mi.is_full)
        union all
        select jsonb_build_object('kind', 'menu', 'level', case when now() > public.menu_deadline(w) then 'err' else 'info' end,
                                  'text', 'Menu de la semaine du ' || to_char(w, 'DD/MM') || ' : ' ||
                                          coalesce((select case status when 'draft' then 'brouillon' when 'submitted' then 'soumis, à publier' end
                                                      from menus where week_start = w and status <> 'published'), 'non créé'))
          from (select (date_trunc('week', d) + interval '7 days')::date w) x
         where not exists (select 1 from menus where week_start = x.w and status = 'published')
      ) al)
  ) into r;
  return r;
end $$;

-- ───────────── Prévisions anti-gaspillage (§6.4) ─────────────
-- Ventes finales attendues = moyenne des 4 derniers mêmes jours de semaine pour ce plat et ce service
-- (repli : moyenne de la catégorie). Recommandé = max(vendus, attendu) arrondi + 5 % de marge.
create or replace function public.admin_forecast(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not public.has_role('chef') then raise exception 'forbidden' using errcode = '42501'; end if;
  with items as (
    select mi.id, mi.service, mi.dish_id, d.name, d.category_id, mi.sold_qty, mi.planned_qty, mi.prepared_qty, mi.served_qty
      from menu_items mi join menus m on m.id = mi.menu_id join dishes d on d.id = mi.dish_id
     where mi.service_date = p_date and m.status in ('published', 'submitted', 'draft')
  ), hist as (
    select i.id,
      (select avg(h.sold_qty) from menu_items h join menus hm on hm.id = h.menu_id
        where hm.status = 'published' and h.dish_id = i.dish_id and h.service = i.service
          and h.service_date in (p_date - 7, p_date - 14, p_date - 21, p_date - 28)) dish_avg,
      (select avg(h.sold_qty) from menu_items h join menus hm on hm.id = h.menu_id join dishes hd on hd.id = h.dish_id
        where hm.status = 'published' and hd.category_id is not distinct from i.category_id and h.service = i.service
          and h.service_date in (p_date - 7, p_date - 14, p_date - 21, p_date - 28)) cat_avg
      from items i
  ), f as (
    select i.*, round(coalesce(h.dish_avg, h.cat_avg, i.sold_qty))::int expected,
           case when h.dish_avg is not null then 'dish' when h.cat_avg is not null then 'category' else 'none' end basis
      from items i join hist h using (id)
  ), rec as (
    select f.*, greatest(f.expected - f.sold_qty, 0) remaining,
           ceil(greatest(f.sold_qty, f.expected) * 1.05)::int recommended
      from f
  ), needs as (
    select ing.id, ing.name, ing.unit, ing.stock_qty, ing.alert_threshold, ing.unit_cost,
           round(sum(rl.qty_per_portion * rec.recommended), 2) need
      from rec join recipe_lines rl on rl.dish_id = rec.dish_id join ingredients ing on ing.id = rl.ingredient_id
     group by ing.id
  )
  select jsonb_build_object(
    'date', p_date,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', id, 'service', service, 'dish', name, 'sold', sold_qty, 'planned', planned_qty, 'prepared', prepared_qty,
                'served', served_qty, 'expected', expected, 'remaining', remaining, 'recommended', recommended, 'basis', basis)
                order by service, recommended desc), '[]') from rec),
    'ingredients', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', id, 'name', name, 'unit', unit, 'stock', stock_qty, 'need', need,
                'to_buy', greatest(round(need - stock_qty + alert_threshold, 2), 0),
                'cost', ceil(greatest(need - stock_qty + alert_threshold, 0) * unit_cost)) order by name), '[]') from needs)
  ) into r;
  return r;
end $$;

-- ───────────── Ventes et rapports (§6.6) ─────────────
create or replace function public.admin_sales(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  t0 timestamptz := p_from::timestamp at time zone 'Africa/Abidjan';
  t1 timestamptz := (p_to + 1)::timestamp at time zone 'Africa/Abidjan';
  r jsonb;
begin
  if not public.has_role('caissier', 'chef') then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'revenue', coalesce((select -sum(amount) from transactions where type in ('purchase', 'refund') and created_at >= t0 and created_at < t1), 0),
    'recharges', coalesce((select sum(amount) from transactions where type in ('recharge', 'recharge_cash') and created_at >= t0 and created_at < t1), 0),
    'transfers', coalesce((select sum(amount) from transactions where type = 'transfer_in' and created_at >= t0 and created_at < t1), 0),
    'tickets', (select count(*) from tickets where service_date between p_from and p_to and status <> 'cancelled'),
    'served', (select count(*) from tickets where service_date between p_from and p_to and status = 'used'),
    'expired', (select count(*) from tickets where service_date between p_from and p_to and status = 'expired'),
    'cancelled', (select count(*) from tickets where service_date between p_from and p_to and status = 'cancelled'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', g::date,
                 'revenue', coalesce((select -sum(amount) from transactions where type in ('purchase', 'refund')
                                        and created_at >= g::date::timestamp at time zone 'Africa/Abidjan'
                                        and created_at < (g::date + 1)::timestamp at time zone 'Africa/Abidjan'), 0),
                 'tickets', (select count(*) from tickets where service_date = g::date and status <> 'cancelled')) order by g), '[]')
               from generate_series(p_from, p_to, interval '1 day') g),
    'dishes', (select coalesce(jsonb_agg(x order by x.sold desc), '[]') from (
                 select d.name, count(*)::int sold, sum(t.total)::int revenue,
                        round(avg(r.stars)::numeric, 1) stars
                   from tickets t join dishes d on d.id = t.dish_id left join ratings r on r.ticket_id = t.id
                  where t.service_date between p_from and p_to and t.status <> 'cancelled'
                  group by d.id) x),
    'heatmap', (select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'h', hh, 'n', n)), '[]') from (
                 select extract(isodow from used_at at time zone 'Africa/Abidjan')::int dow,
                        extract(hour from used_at at time zone 'Africa/Abidjan')::int hh, count(*) n
                   from tickets where used_at >= t0 and used_at < t1 group by 1, 2) x)
  ) into r;
  return r;
end $$;

-- ───────────── Gaspillage (§6.7) ─────────────
create or replace function public.admin_waste(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not public.has_role('chef') then raise exception 'forbidden' using errcode = '42501'; end if;
  with it as (
    select mi.service_date, mi.prepared_qty, mi.served_qty, d.name,
           greatest(coalesce(mi.prepared_qty, 0) - mi.served_qty, 0) lost,
           (select coalesce(sum(rl.qty_per_portion * i.unit_cost), 0) from recipe_lines rl join ingredients i on i.id = rl.ingredient_id
             where rl.dish_id = mi.dish_id) portion_cost
      from menu_items mi join dishes d on d.id = mi.dish_id join menus m on m.id = mi.menu_id
     where m.status = 'published' and mi.service_date between p_from and p_to and mi.prepared_qty is not null
  )
  select jsonb_build_object(
    'prepared', coalesce(sum(prepared_qty), 0), 'served', coalesce(sum(served_qty), 0), 'lost', coalesce(sum(lost), 0),
    'cost', coalesce(ceil(sum(lost * portion_cost)), 0),
    'daily', (select coalesce(jsonb_agg(x order by x.day), '[]') from (
                select service_date as day, sum(prepared_qty)::int prepared, sum(served_qty)::int served, sum(lost)::int lost,
                       ceil(sum(lost * portion_cost))::int cost
                  from it group by 1) x),
    'dishes', (select coalesce(jsonb_agg(x order by x.lost desc), '[]') from (
                select name, sum(lost)::int lost, ceil(sum(lost * portion_cost))::int cost,
                       round(100.0 * sum(lost) / nullif(sum(prepared_qty), 0), 1) rate
                  from it group by name) x)
  ) into r from it;
  return r;
end $$;

-- ───────────── Avis (§6.10) ─────────────
create or replace function public.admin_ratings() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role('chef') then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'dishes', (select coalesce(jsonb_agg(x order by x.avg_stars nulls last), '[]') from (
                 select d.id, d.name, d.photo_url, round(avg(r.stars)::numeric, 2) avg_stars, count(r.id)::int n,
                        jsonb_build_object('1', count(*) filter (where r.stars = 1), '2', count(*) filter (where r.stars = 2),
                                           '3', count(*) filter (where r.stars = 3), '4', count(*) filter (where r.stars = 4),
                                           '5', count(*) filter (where r.stars = 5)) dist,
                        round(avg(r.stars) filter (where r.created_at > now() - interval '7 days')::numeric, 2) last7
                   from dishes d left join ratings r on r.dish_id = d.id group by d.id) x),
    'recent', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
                 select r.id, d.name dish, r.stars, r.comment, r.author, r.created_at
                   from ratings r join dishes d on d.id = r.dish_id
                  where r.comment is not null order by r.created_at desc limit 25) x));
end $$;

-- ───────────── Affluence (§6.11) ─────────────
create or replace function public.admin_occupancy(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d date := coalesce(p_date, public.today_abidjan());
  v_room public.rooms;
begin
  if not public.has_role('caissier', 'chef') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_room from rooms order by name limit 1;
  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'now', public.occupancy_now(v_room.id),
    'last', (select to_jsonb(s) from occupancy_snapshots s where room_id = v_room.id order by created_at desc limit 1),
    'curve', (select coalesce(jsonb_agg(jsonb_build_object('t', created_at, 'rate', rate, 'people', people_count) order by created_at), '[]')
                from occupancy_snapshots where room_id = v_room.id
                 and created_at >= d::timestamp at time zone 'Africa/Abidjan' and created_at < (d + 1)::timestamp at time zone 'Africa/Abidjan'),
    'peaks', (select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'h', hh, 'rate', rate)), '[]') from (
                select extract(isodow from created_at at time zone 'Africa/Abidjan')::int dow,
                       extract(hour from created_at at time zone 'Africa/Abidjan')::int hh, round(avg(rate)) rate
                  from occupancy_snapshots where room_id = v_room.id and created_at > now() - interval '28 days'
                 group by 1, 2) x));
end $$;

-- ───────────── Caisse : recherche client (§6.8) ─────────────
create or replace function public.admin_find_users(p_query text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare q text := btrim(coalesce(p_query, ''));
begin
  if not public.has_role('caissier') then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(x), '[]') from (
    select p.id, p.full_name, p.phone, p.short_code, p.role, p.points, p.is_blocked, w.balance, u.email
      from profiles p join wallets w on w.user_id = p.id join auth.users u on u.id = p.id
     where q = '' or p.full_name ilike '%' || q || '%' or p.short_code ilike '%' || q || '%'
        or p.phone like '%' || regexp_replace(q, '\D', '', 'g') || '%' and length(regexp_replace(q, '\D', '', 'g')) >= 4
        or u.email ilike '%' || q || '%'
     order by p.full_name limit 30) x);
end $$;

-- ───────────── Menu : copier la semaine précédente (§6.3) ─────────────
create or replace function public.copy_menu_week(p_week_start date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_menu uuid; v_n int;
begin
  if not public.has_role('chef') then return public._fail('FORBIDDEN', 'Réservé au chef.'); end if;
  if extract(isodow from p_week_start) <> 1 then return public._fail('BAD_WEEK', 'La semaine doit commencer un lundi.'); end if;
  select id into v_menu from menus where week_start = p_week_start;
  if v_menu is null then
    insert into menus (week_start) values (p_week_start) returning id into v_menu;
  elsif (select status from menus where id = v_menu) <> 'draft' then
    return public._fail('INVALID_STATUS', 'Ce menu n''est plus un brouillon.');
  end if;
  insert into menu_items (menu_id, service_date, service, dish_id, price, planned_qty)
  select v_menu, mi.service_date + 7, mi.service, mi.dish_id, d.base_price, mi.planned_qty
    from menu_items mi join menus m on m.id = mi.menu_id join dishes d on d.id = mi.dish_id
   where m.week_start = p_week_start - 7 and d.is_active
  on conflict (service_date, service, dish_id) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'menu_id', v_menu, 'copied', v_n);
end $$;

revoke all on function public.admin_overview(date), public.admin_forecast(date), public.admin_sales(date, date),
  public.admin_waste(date, date), public.admin_ratings(), public.admin_occupancy(date), public.admin_find_users(text),
  public.copy_menu_week(date) from public, anon;
grant execute on function public.admin_overview(date), public.admin_forecast(date), public.admin_sales(date, date),
  public.admin_waste(date, date), public.admin_ratings(), public.admin_occupancy(date), public.admin_find_users(text),
  public.copy_menu_week(date) to authenticated, service_role;
