-- Affluence : un service n'est « ouvert » que s'il a des plats au menu publié ce jour-là
-- (ex. pas de dîner le samedi).
create or replace function public._service_on_menu(p_date date, p_service public.service_kind) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from menu_items mi join menus m on m.id = mi.menu_id
                  where m.status = 'published' and mi.service_date = p_date and mi.service = p_service)
$$;
revoke all on function public._service_on_menu(date, public.service_kind) from public, anon, authenticated;

create or replace function public.occupancy_now(p_room_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_room public.rooms;
  v_snap public.occupancy_snapshots;
  v_scans int;
  v_rate numeric;
  v_source text;
  v_today date := public.today_abidjan();
  v_svc public.service_kind;
  v_win record;
  v_next jsonb;
begin
  select * into v_room from public.rooms where p_room_id is null or id = p_room_id order by name limit 1;
  if not found then return jsonb_build_object('status', 'unknown'); end if;

  -- Service en cours ?
  foreach v_svc in array array['lunch', 'dinner']::public.service_kind[] loop
    select * into v_win from public.service_window(v_today, v_svc);
    exit when now() between v_win.starts_at and v_win.ends_at and public._service_on_menu(v_today, v_svc);
    v_win := null;
  end loop;

  if v_win is null then
    select jsonb_build_object('service', s.svc, 'starts_at', w.starts_at) into v_next
      from (values ('lunch'::public.service_kind, 0), ('dinner', 1)) s(svc, o),
           lateral public.service_window(v_today, s.svc) w
     where w.starts_at > now() and public._service_on_menu(v_today, s.svc) order by w.starts_at limit 1;
    return jsonb_build_object('status', 'closed', 'room', v_room.name, 'next', v_next);
  end if;

  select count(*) into v_scans from public.tickets where used_at > now() - interval '10 minutes';
  select * into v_snap from public.occupancy_snapshots
   where room_id = v_room.id and created_at > now() - interval '2 minutes' order by created_at desc limit 1;

  if found then
    v_rate := v_snap.rate; v_source := 'vision';
  else
    -- ~ 1 table occupée 25 min par 3 couverts : estimation grossière à partir des passages au comptoir
    v_rate := least(100, round(v_scans * 25.0 / 10 / 3 / v_room.total_tables * 100)); v_source := 'scans';
  end if;

  return jsonb_build_object(
    'status', 'open',
    'room', v_room.name,
    'service', v_svc,
    'rate', v_rate,
    'level', case when v_rate < 50 then 'low' when v_rate <= 80 then 'mid' else 'high' end,
    'occupied_tables', coalesce(v_snap.occupied_tables, round(v_rate * v_room.total_tables / 100)),
    'total_tables', v_room.total_tables,
    'wait_min', greatest(0, round(greatest(v_rate - 40, 0) / 5 + v_scans / 6.0))::int,
    'source', v_source,
    'updated_at', coalesce(v_snap.created_at, now()));
end $$;

