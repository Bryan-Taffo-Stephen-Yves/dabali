-- Notifications automatiques liées aux services (§4.10). Cron toutes les 5 min, idempotent.
--  - « Votre ticket est valable » : au début du service
--  - « Votre ticket expire dans 30 min » : 30 min avant la fin du service, s'il n'est pas encore scanné
--  - « Places libres au réfectoire » : clients ayant activé l'alerte, une fois par service, quand l'occupation < 50 %
create or replace function public.notify_service_events(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_started int; v_expiring int; v_seats int := 0;
  v_occ jsonb;
  v_key text;
begin
  -- Début de service
  with t as (
    select t.id, t.user_id, d.name, t.service from tickets t join dishes d on d.id = t.dish_id
     where t.status = 'valid' and t.valid_from <= p_now and t.valid_from > p_now - interval '30 minutes'
       and not exists (select 1 from notifications n where n.type = 'ticket_valid' and n.data ->> 'ticket_id' = t.id::text)
  )
  insert into notifications (user_id, type, title, body, data)
  select user_id, 'ticket_valid', 'Votre repas vous attend 🍽️',
         name || ' : le ' || case service when 'lunch' then 'déjeuner' else 'dîner' end || ' a commencé. Présentez votre QR au comptoir.',
         jsonb_build_object('ticket_id', id)
    from t;
  get diagnostics v_started = row_count;

  -- Expiration proche
  with t as (
    select t.id, t.user_id, d.name from tickets t join dishes d on d.id = t.dish_id
     where t.status = 'valid' and t.valid_until > p_now and t.valid_until <= p_now + interval '30 minutes'
       and not exists (select 1 from notifications n where n.type = 'ticket_expiring' and n.data ->> 'ticket_id' = t.id::text)
  )
  insert into notifications (user_id, type, title, body, data)
  select user_id, 'ticket_expiring', 'Votre ticket expire bientôt ⏳',
         name || ' : il reste moins de 30 min pour le récupérer.', jsonb_build_object('ticket_id', id)
    from t;
  get diagnostics v_expiring = row_count;

  -- Places libres
  v_occ := public.occupancy_now();
  if v_occ ->> 'status' = 'open' and v_occ ->> 'source' = 'vision' and (v_occ ->> 'rate')::numeric < 50 then
    v_key := public.today_abidjan()::text || '-' || (v_occ ->> 'service');
    insert into notifications (user_id, type, title, body, data)
    select p.id, 'free_seats', 'Des places se libèrent 🪑',
           'Le réfectoire est à ' || round((v_occ ->> 'rate')::numeric) || ' % : c''est le bon moment.',
           jsonb_build_object('service_key', v_key)
      from profiles p
     where p.notify_free_seats and not p.is_blocked
       and not exists (select 1 from notifications n where n.user_id = p.id and n.type = 'free_seats' and n.data ->> 'service_key' = v_key);
    get diagnostics v_seats = row_count;
  end if;

  return jsonb_build_object('ticket_valid', v_started, 'ticket_expiring', v_expiring, 'free_seats', v_seats);
end $$;

revoke all on function public.notify_service_events(timestamptz) from public, anon, authenticated;
grant execute on function public.notify_service_events(timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('dabali-service-notifications', '*/5 * * * *', 'select public.notify_service_events()');
  end if;
end $$;
