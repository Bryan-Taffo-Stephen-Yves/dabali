-- File d'attente vue par la caméra : nombre de personnes dans le couloir (zones dessinées avec vision/calibrate.py)
-- et temps d'attente réel = personnes dans la file ÷ rythme du comptoir (scans des 10 dernières minutes).
alter table public.occupancy_snapshots
  add column queue_count int check (queue_count >= 0),
  add column counter_count int check (counter_count >= 0);

-- Rythme du comptoir mesuré par les scans ; 3 personnes / min par défaut tant qu'il y a trop peu de scans
create function public._queue_wait_min(p_queue int, p_scans_10min int) returns int
language sql immutable as $$
  select case when coalesce(p_queue, 0) = 0 then 0
              else ceil(p_queue / greatest(coalesce(p_scans_10min, 0) / 10.0, case when coalesce(p_scans_10min, 0) < 5 then 3 else 0.5 end))::int end
$$;

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

  foreach v_svc in array enum_range(null::public.service_kind) loop
    select * into v_win from public.service_window(v_today, v_svc);
    exit when v_win.starts_at is not null and now() between v_win.starts_at and v_win.ends_at
              and public._service_on_menu(v_today, v_svc);
    v_win := null;
  end loop;

  if v_win is null then
    select jsonb_build_object('service', mi.service, 'starts_at', w.starts_at) into v_next
      from menu_items mi join menus m on m.id = mi.menu_id
      cross join lateral public.service_window(mi.service_date, mi.service) w
     where m.status = 'published' and mi.service_date between v_today and v_today + 7 and w.starts_at > now()
     order by w.starts_at limit 1;
    return jsonb_build_object('status', 'closed', 'room', v_room.name, 'next', v_next);
  end if;

  select count(*) into v_scans from public.tickets where used_at > now() - interval '10 minutes';
  select * into v_snap from public.occupancy_snapshots
   where room_id = v_room.id and created_at > now() - interval '2 minutes' order by created_at desc limit 1;
  if found then
    v_rate := v_snap.rate; v_source := 'vision';
  else
    v_rate := least(100, round(v_scans * 25.0 / 10 / 3 / v_room.total_tables * 100)); v_source := 'scans';
  end if;

  return jsonb_build_object(
    'status', 'open', 'room', v_room.name, 'service', v_svc, 'rate', v_rate,
    'queue_count', v_snap.queue_count,
    'level', case when v_rate < 50 then 'low' when v_rate <= 80 then 'mid' else 'high' end,
    'occupied_tables', coalesce(v_snap.occupied_tables, round(v_rate * v_room.total_tables / 100)),
    'total_tables', v_room.total_tables,
    'wait_min', case when v_snap.queue_count is not null then public._queue_wait_min(v_snap.queue_count, v_scans)
                     else greatest(0, round(greatest(v_rate - 40, 0) / 5 + v_scans / 6.0))::int end,
    'wait_source', case when v_snap.queue_count is not null then 'queue' else 'estimate' end,
    'source', v_source, 'updated_at', coalesce(v_snap.created_at, now()));
end $$;
