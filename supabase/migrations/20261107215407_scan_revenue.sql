-- L'argent d'un ticket ne revient au prestataire qu'au SCAN (repas servi).
-- Ticket jamais scanné : remboursé automatiquement à l'expiration (48 h), avec un rappel 3 h avant.
-- Chiffre d'affaires du prestataire = valeur des tickets scannés ; argent des tickets valides = « en attente ».

alter table public.tickets add column expiry_reminded_at timestamptz;

create function public._served_value(p_from timestamptz, p_to timestamptz) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(total), 0)::int from tickets where status = 'used' and used_at >= p_from and used_at < p_to
$$;

create function public._expired_refunds(p_from timestamptz, p_to timestamptz) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(t.amount), 0)::int from transactions t join tickets k on k.id = t.ticket_id
   where t.type = 'refund' and k.status = 'expired' and t.created_at >= p_from and t.created_at < p_to
$$;
revoke all on function public._served_value(timestamptz, timestamptz), public._expired_refunds(timestamptz, timestamptz) from public, anon, authenticated;

-- Expiration : chaque ticket non scanné est remboursé à l'acheteur (points rendus pour un ticket offert).
-- « skip locked » : un ticket en cours de scan au même instant n'est pas touché (le scan l'emporte).
create or replace function public.expire_tickets() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t public.tickets; v_count int := 0; v_label text;
begin
  for v_t in select * from public.tickets where status = 'valid' and valid_until <= now()
              order by valid_until for no key update skip locked loop
    update public.tickets set status = 'expired' where id = v_t.id and status = 'valid';
    continue when not found;
    v_count := v_count + 1;
    v_label := public.service_label(v_t.service);
    if v_t.total > 0 then
      perform 1 from public.wallets where user_id = v_t.buyer_id for update;
      perform public._wallet_move(v_t.buyer_id, v_t.total, 'refund', p_ticket => v_t.id,
                                  p_note => 'Remboursement automatique · ticket ' || v_label || ' non utilisé');
      perform public._notify(v_t.buyer_id, 'ticket_refunded', 'Ticket ' || v_label || ' remboursé',
        'Ton ticket n''a pas été utilisé à temps : ' || public.fcfa(v_t.total) || ' sont revenus sur ton solde.',
        jsonb_build_object('ticket_id', v_t.id));
    end if;
    if v_t.is_reward then
      update public.profiles set points = points + coalesce((public.setting('loyalty') ->> 'reward_points')::int, 10)
       where id = v_t.buyer_id;
      perform public._notify(v_t.buyer_id, 'ticket_refunded', 'Ticket offert expiré',
        'Tes points de fidélité t''ont été rendus.', jsonb_build_object('ticket_id', v_t.id));
    end if;
  end loop;

  -- Rappel 3 h avant l'expiration (une seule fois par ticket)
  with due as (
    update public.tickets set expiry_reminded_at = now()
     where status = 'valid' and expiry_reminded_at is null
       and valid_until > now() and valid_until <= now() + interval '3 hours'
    returning id, user_id, service, valid_until
  )
  insert into public.notifications (user_id, type, title, body, data)
  select user_id, 'ticket_expiring', 'Ton ticket ' || public.service_label(service) || ' expire bientôt',
         'Il expire à ' || to_char(valid_until at time zone 'Africa/Abidjan', 'HH24"h"MI')
         || '. Viens manger ! Sinon, il te sera remboursé automatiquement.', jsonb_build_object('ticket_id', id)
    from due;
  return v_count;
end $$;
revoke all on function public.expire_tickets() from public, anon, authenticated;
grant execute on function public.expire_tickets() to service_role;

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
    -- Encaissé = valeur des tickets SCANNÉS (repas servis) : c'est ce qui revient au prestataire.
    'revenue', public._served_value(d0, d1),
    'sales', coalesce((select -sum(amount) from transactions where type in ('purchase', 'refund') and created_at >= d0 and created_at < d1), 0),
    'held', coalesce((select sum(total) from tickets where status = 'valid'), 0)::int,
    'refunded_expired', public._expired_refunds(d0, d1),
    'recharges', coalesce((select sum(amount) from transactions where type in ('recharge', 'recharge_cash') and created_at >= d0 and created_at < d1), 0),
    'recharges_cash', coalesce((select sum(amount) from transactions where type = 'recharge_cash' and created_at >= d0 and created_at < d1), 0),
    'sold', (select count(*) from tickets where created_at >= d0 and created_at < d1 and status <> 'cancelled'),
    'served', (select count(*) from tickets where used_at >= d0 and used_at < d1),
    'expired', (select count(*) from tickets where status = 'expired' and valid_until >= d0 and valid_until < d1),
    'outstanding', (select count(*) from tickets where status = 'valid' and valid_until > now()),
    'avg_basket', coalesce((select round(avg(total)) from tickets where created_at >= d0 and created_at < d1 and status <> 'cancelled' and total > 0), 0),
    'sold_out', (select count(*) from menu_items mi join menus m on m.id = mi.menu_id
                  where m.status = 'published' and mi.service_date = d and (mi.is_sold_out or mi.is_full)),
    'occupancy', public.occupancy_now(),
    'by_hour', (select coalesce(jsonb_agg(jsonb_build_object('h', h, 'sales', coalesce(s.n, 0), 'scans', coalesce(sc.n, 0)) order by h), '[]')
                  from generate_series(6, 21) h
                  left join (select extract(hour from created_at at time zone 'Africa/Abidjan')::int hh, count(*) n
                               from tickets where created_at >= d0 and created_at < d1 group by 1) s on s.hh = h
                  left join (select extract(hour from used_at at time zone 'Africa/Abidjan')::int hh, count(*) n
                               from tickets where used_at >= d0 and used_at < d1 group by 1) sc on sc.hh = h),
    'top_dishes', (select coalesce(jsonb_agg(x order by x.sold desc), '[]') from (
                    select d2.name, d2.photo_url, count(*)::int sold
                      from tickets t join dishes d2 on d2.id = t.dish_id
                     where t.service_date between d - 6 and d and t.status = 'used'
                     group by d2.id order by 3 desc limit 5) x),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('service', s.svc, 'label', public.service_label(s.svc),
                     'served', (select count(*) from tickets t where t.service_date = d and t.service = s.svc and t.status = 'used'),
                     'outstanding', (select count(*) from tickets t where t.service = s.svc and t.status = 'valid' and t.valid_until > now()),
                     'planned', (select sum(mi.planned_qty)::int from menu_items mi join menus m on m.id = mi.menu_id
                                  where m.status = 'published' and mi.service_date = d and mi.service = s.svc))
                   order by s.o), '[]')
                   from unnest(enum_range(null::public.service_kind)) with ordinality s(svc, o)
                  where public._service_on_menu(d, s.svc)),
    'alerts', (
      select coalesce(jsonb_agg(a), '[]') from (
        select jsonb_build_object('kind', 'stock', 'level', 'warn', 'text', 'Stock bas : ' || name || ' (' || public._num(stock_qty) || ' ' || unit || ')') a
          from ingredients where stock_qty < alert_threshold
        union all
        select jsonb_build_object('kind', 'sold_out', 'level', 'err', 'text', 'Rupture : ' || d2.name || ' (' || lower(public.service_label(mi.service)) || ')')
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

create or replace function public.admin_sales(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  t0 timestamptz := p_from::timestamp at time zone 'Africa/Abidjan';
  t1 timestamptz := (p_to + 1)::timestamp at time zone 'Africa/Abidjan';
  r jsonb;
begin
  if not public.has_role('caissier', 'chef') then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'revenue', public._served_value(t0, t1),
    'sales', coalesce((select -sum(amount) from transactions where type in ('purchase', 'refund') and created_at >= t0 and created_at < t1), 0),
    'held', coalesce((select sum(total) from tickets where status = 'valid'), 0)::int,
    'refunded_expired', public._expired_refunds(t0, t1),
    'recharges', coalesce((select sum(amount) from transactions where type in ('recharge', 'recharge_cash') and created_at >= t0 and created_at < t1), 0),
    'transfers', coalesce((select sum(amount) from transactions where type = 'transfer_in' and created_at >= t0 and created_at < t1), 0),
    'tickets', (select count(*) from tickets where created_at >= t0 and created_at < t1 and status <> 'cancelled'),
    'served', (select count(*) from tickets where used_at >= t0 and used_at < t1),
    'expired', (select count(*) from tickets where status = 'expired' and valid_until >= t0 and valid_until < t1),
    'cancelled', (select count(*) from tickets where cancelled_at >= t0 and cancelled_at < t1),
    'by_service', (select coalesce(jsonb_agg(jsonb_build_object('service', service, 'label', public.service_label(service), 'n', n) order by service), '[]')
                     from (select service, count(*)::int n from tickets where created_at >= t0 and created_at < t1 and status <> 'cancelled' group by 1) x),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', g::date,
                 'revenue', public._served_value(g::date::timestamp at time zone 'Africa/Abidjan',
                                                 (g::date + 1)::timestamp at time zone 'Africa/Abidjan'),
                 'tickets', (select count(*) from tickets where service_date = g::date and status = 'used')) order by g), '[]')
               from generate_series(p_from, p_to, interval '1 day') g),
    'dishes', (select coalesce(jsonb_agg(x order by x.sold desc), '[]') from (
                 select d.name, count(*)::int sold, sum(t.total)::int revenue, round(avg(r.stars)::numeric, 1) stars
                   from tickets t join dishes d on d.id = t.dish_id left join ratings r on r.ticket_id = t.id
                  where t.service_date between p_from and p_to and t.status = 'used'
                  group by d.id) x),
    'heatmap', (select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'h', hh, 'n', n)), '[]') from (
                 select extract(isodow from used_at at time zone 'Africa/Abidjan')::int dow,
                        extract(hour from used_at at time zone 'Africa/Abidjan')::int hh, count(*) n
                   from tickets where used_at >= t0 and used_at < t1 group by 1, 2) x)
  ) into r;
  return r;
end $$;
