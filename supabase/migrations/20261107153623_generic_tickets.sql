-- Dabali v2 — tickets par type de repas (petit-déjeuner, déjeuner, snack, dîner)
-- Le client achète N tickets d'un type (+ supplément éventuel), valables 48 h.
-- Le plat est choisi au comptoir : l'agent scanne (redeem_ticket) puis indique le plat servi (serve_dish).

-- ═════════════ Paramètres ═════════════
insert into public.settings (key, value) values
  ('services', '{"breakfast":{"label":"Petit-déjeuner","start":"06:30","end":"09:30","price":500,"extras":false},
                 "lunch":{"label":"Déjeuner","start":"11:30","end":"14:30","price":2500,"extras":true},
                 "snack":{"label":"Snack","start":"15:30","end":"17:00","price":700,"extras":false},
                 "dinner":{"label":"Dîner","start":"17:30","end":"20:00","price":2500,"extras":true}}'),
  ('ticket_validity_hours', '48'),
  ('loyalty', '{"points_per_ticket":1,"reward_points":10,"reward_service":"breakfast"}')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ═════════════ Tickets génériques ═════════════
alter table public.tickets
  alter column menu_item_id drop not null,
  alter column dish_id drop not null,
  alter column service_date drop not null,
  add column is_reward boolean not null default false;
comment on column public.tickets.service is 'Type de ticket (repas auquel il donne droit)';
comment on column public.tickets.service_date is 'Jour où le ticket a été utilisé (null tant qu''il est valide)';
comment on column public.tickets.dish_id is 'Plat servi au comptoir (null tant que non servi)';
grant select (is_reward) on public.tickets to authenticated;

-- sold_qty d'un plat = portions servies au comptoir (plus de précommande par plat)
update public.menu_items set sold_qty = served_qty where sold_qty <> served_qty;

-- Les tickets encore valides de l'ancien modèle deviennent des tickets génériques
update public.tickets
   set menu_item_id = null, dish_id = null, service_date = null,
       valid_from = created_at, valid_until = greatest(valid_until, now() + interval '48 hours')
 where status = 'valid';

drop function if exists public.purchase_ticket(uuid, uuid[], text, uuid, boolean);

create or replace function public.service_label(p_service public.service_kind) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.setting('services') -> p_service::text ->> 'label', p_service::text)
$$;

-- ═════════════ Achat ═════════════
create or replace function public.purchase_tickets(p_service public.service_kind, p_quantity int default 1,
                                                   p_extra_ids uuid[] default '{}', p_pin text default null,
                                                   p_beneficiary_id uuid default null, p_use_reward boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles;
  v_for uuid := coalesce(p_beneficiary_id, auth.uid());
  v_cfg jsonb := public.setting('services') -> p_service::text;
  v_loy jsonb := public.setting('loyalty');
  v_hours int := coalesce((public.setting('ticket_validity_hours'))::int, 48);
  v_price int;
  v_extras jsonb := '[]';
  v_extra_total int := 0;
  v_unit int;
  v_total int;
  v_reward boolean := false;
  v_err text;
  v_balance int;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_tx public.transactions;
  v_label text := public.service_label(p_service);
begin
  if v_uid is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  select * into v_me from public.profiles where id = v_uid;
  if v_me.is_blocked then return public._fail('ACCOUNT_BLOCKED', 'Votre compte est bloqué.'); end if;
  if v_cfg is null or (v_cfg ->> 'price') is null then return public._fail('SERVICE_UNKNOWN', 'Type de ticket inconnu.'); end if;
  if p_quantity is null or p_quantity not between 1 and 10 then
    return public._fail('INVALID_QUANTITY', 'Entre 1 et 10 tickets par achat.');
  end if;
  if v_for <> v_uid and not exists (select 1 from public.profiles where id = v_for and not is_blocked) then
    return public._fail('RECIPIENT_NOT_FOUND', 'Bénéficiaire introuvable.');
  end if;
  v_price := (v_cfg ->> 'price')::int;

  -- Suppléments : une entrée et/ou un dessert, seulement si le service le permet
  p_extra_ids := coalesce(p_extra_ids, '{}');
  if cardinality(p_extra_ids) > 0 then
    if not coalesce((v_cfg ->> 'extras')::boolean, false) then
      return public._fail('EXTRAS_NOT_ALLOWED', 'Pas de supplément pour le ' || lower(v_label) || '.');
    end if;
    if (select count(*) from public.extras where id = any (p_extra_ids) and is_active and kind in ('starter', 'dessert'))
       <> (select count(distinct x) from unnest(p_extra_ids) x)
       or exists (select 1 from public.extras where id = any (p_extra_ids) group by kind having count(*) > 1) then
      return public._fail('INVALID_EXTRA', 'Choisissez au plus une entrée et un dessert.');
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'price', price) order by kind), '[]'),
           coalesce(sum(price), 0)
      into v_extras, v_extra_total
      from public.extras where id = any (p_extra_ids);
  end if;
  v_unit := v_price + v_extra_total;

  -- Fidélité : 10 points = 1 ticket offert (petit-déjeuner par défaut)
  if p_use_reward then
    if p_service::text <> coalesce(v_loy ->> 'reward_service', 'breakfast') then
      return public._fail('REWARD_UNAVAILABLE', 'Vos points offrent un ticket ' || lower(public.service_label((v_loy ->> 'reward_service')::public.service_kind)) || '.');
    end if;
    if v_me.points < (v_loy ->> 'reward_points')::int then
      return public._fail('REWARD_UNAVAILABLE', 'Il vous faut ' || (v_loy ->> 'reward_points') || ' points.');
    end if;
    v_reward := true;
  end if;
  v_total := v_unit * p_quantity - case when v_reward then v_unit else 0 end;

  if v_total > coalesce((public.setting('pin_threshold'))::int, 5000) or v_for <> v_uid then
    v_err := public._check_pin(v_uid, p_pin);
    if v_err is not null then return public._pin_fail(v_err); end if;
  end if;

  select balance into v_balance from public.wallets where user_id = v_uid for update;
  if v_balance < v_total then
    return public._fail('INSUFFICIENT_FUNDS', 'Solde insuffisant.', jsonb_build_object('balance', v_balance, 'total', v_total));
  end if;

  for i in 1..p_quantity loop
    insert into public.tickets (user_id, buyer_id, service, extras, total, is_reward, valid_from, valid_until)
    values (v_for, v_uid, p_service, v_extras, case when v_reward and i = 1 then 0 else v_unit end,
            v_reward and i = 1, now(), now() + make_interval(hours => v_hours))
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  if v_total > 0 then
    v_tx := public._wallet_move(v_uid, -v_total, 'purchase', p_ticket => case when p_quantity = 1 then v_ids[1] end,
              p_counterpart => nullif(v_for, v_uid),
              p_note => p_quantity || ' × ticket ' || v_label ||
                        coalesce(' + ' || (select string_agg(e ->> 'name', ' + ') from jsonb_array_elements(v_extras) e), ''));
  end if;
  if v_reward then
    update public.profiles set points = points - (v_loy ->> 'reward_points')::int where id = v_uid;
  end if;
  if v_for <> v_uid then
    perform public._notify(v_for, 'meal_gift', 'Un repas vous est offert 🎁',
      v_me.full_name || ' vous offre ' || p_quantity || ' ticket' || case when p_quantity > 1 then 's' else '' end || ' ' || v_label || '.',
      jsonb_build_object('ticket_ids', to_jsonb(v_ids)));
  end if;

  return jsonb_build_object('ok', true, 'ticket_ids', to_jsonb(v_ids), 'total', v_total,
    'balance', (select balance from public.wallets where user_id = v_uid), 'reward_used', v_reward);
end $$;

-- ═════════════ Annulation : un ticket non utilisé est remboursable tant qu'il est valide ═════════════
create or replace function public.cancel_ticket(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tickets;
begin
  if v_uid is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  select * into v_t from public.tickets where id = p_ticket_id and v_uid in (user_id, buyer_id) for no key update;
  if not found then return public._fail('TICKET_NOT_FOUND', 'Ticket introuvable.'); end if;
  if v_t.status <> 'valid' or v_t.valid_until <= now() then
    return public._fail('NOT_CANCELLABLE', 'Ce ticket ne peut plus être annulé.');
  end if;

  update public.tickets set status = 'cancelled', cancelled_at = now() where id = v_t.id;
  if v_t.total > 0 then
    perform 1 from public.wallets where user_id = v_t.buyer_id for update;
    perform public._wallet_move(v_t.buyer_id, v_t.total, 'refund', p_ticket => v_t.id,
                                p_note => 'Annulation ticket ' || public.service_label(v_t.service));
  end if;
  if v_t.is_reward then
    update public.profiles set points = points + coalesce((public.setting('loyalty') ->> 'reward_points')::int, 10)
     where id = v_t.buyer_id;
  end if;
  return jsonb_build_object('ok', true, 'refunded', v_t.total,
                            'balance', (select balance from public.wallets where user_id = v_uid));
end $$;

-- ═════════════ Comptoir ═════════════
create or replace function public.service_counters(p_date date, p_service public.service_kind) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'served', (select count(*) from tickets where service_date = p_date and service = p_service and status = 'used'),
    'outstanding', (select count(*) from tickets where service = p_service and status = 'valid' and valid_until > now()),
    -- compatibilité : « vendus » = servis + tickets encore valides
    'sold', (select count(*) from tickets where service_date = p_date and service = p_service and status = 'used')
          + (select count(*) from tickets where service = p_service and status = 'valid' and valid_until > now()))
$$;

-- Plats du service, pour que l'agent indique celui qui est servi
create or replace function public._service_dishes(p_date date, p_service public.service_kind) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'menu_item_id', mi.id, 'name', d.name, 'photo_url', d.photo_url,
           'available', not (mi.is_sold_out or mi.is_full),
           'left', case when mi.planned_qty is null then null else greatest(mi.planned_qty - mi.sold_qty, 0) end)
         order by (mi.is_sold_out or mi.is_full), d.name), '[]')
    from menu_items mi join menus m on m.id = mi.menu_id join dishes d on d.id = mi.dish_id
   where m.status = 'published' and mi.service_date = p_date and mi.service = p_service
$$;

-- Étape 1 au comptoir : validation atomique du ticket (appelée par l'Edge Function après vérification HMAC)
create or replace function public.redeem_ticket(p_ticket_id uuid, p_nonce text, p_agent_id uuid,
                                                p_service_date date, p_service public.service_kind)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_t public.tickets;
  v_agent public.profiles;
  v_client text;
  v_by text;
begin
  select * into v_agent from public.profiles where id = p_agent_id;
  if not found or v_agent.is_blocked or v_agent.role not in ('agent', 'admin') then
    return public._fail('FORBIDDEN', 'Compte agent requis.');
  end if;

  -- Une seule transaction peut faire passer valid → used, même avec plusieurs scanners
  update public.tickets
     set status = 'used', used_at = now(), scanned_by = p_agent_id, service_date = p_service_date
   where id = p_ticket_id and qr_nonce = p_nonce and status = 'valid' and service = p_service
     and now() < valid_until
  returning * into v_t;

  if not found then
    select * into v_t from public.tickets where id = p_ticket_id;
    if not found or v_t.qr_nonce <> p_nonce then
      return public._fail('INVALID_QR', 'QR invalide.');
    elsif v_t.status = 'used' then
      select full_name into v_by from public.profiles where id = v_t.scanned_by;
      return public._fail('ALREADY_USED',
        'Déjà utilisé le ' || to_char(v_t.used_at at time zone 'Africa/Abidjan', 'DD/MM "à" HH24"h"MI') || ' par ' || coalesce(v_by, '?') || '.',
        jsonb_build_object('used_at', v_t.used_at, 'scanned_by', v_by));
    elsif v_t.status = 'cancelled' then
      return public._fail('CANCELLED', 'Ticket annulé (remboursé).');
    elsif v_t.status = 'expired' or now() >= v_t.valid_until then
      return public._fail('EXPIRED', 'Ticket expiré le ' || to_char(v_t.valid_until at time zone 'Africa/Abidjan', 'DD/MM "à" HH24"h"MI') || '.');
    else
      return public._fail('WRONG_SERVICE', 'Ticket ' || public.service_label(v_t.service) || ' : pas valable pour le '
        || lower(public.service_label(p_service)) || '.', jsonb_build_object('service', v_t.service));
    end if;
  end if;

  update public.profiles set points = points + coalesce((public.setting('loyalty') ->> 'points_per_ticket')::int, 1)
   where id = v_t.user_id returning full_name into v_client;
  perform public._audit('redeem_ticket', v_t.id::text, jsonb_build_object('service', v_t.service), p_agent_id);

  return jsonb_build_object('ok', true, 'ticket_id', v_t.id, 'client', v_client,
    'ticket', public.service_label(v_t.service), 'service', v_t.service, 'extras', v_t.extras, 'used_at', v_t.used_at,
    'dishes', public._service_dishes(p_service_date, p_service),
    'counters', public.service_counters(p_service_date, p_service));
end $$;

-- Étape 2 au comptoir : l'agent indique le plat servi (stock, gaspillage, avis, prévisions)
create or replace function public.serve_dish(p_ticket_id uuid, p_menu_item_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tickets;
  v_mi record;
begin
  if not public.has_role('agent') then return public._fail('FORBIDDEN', 'Compte agent requis.'); end if;
  select * into v_t from public.tickets where id = p_ticket_id for no key update;
  if not found or v_t.status <> 'used' then return public._fail('TICKET_NOT_FOUND', 'Scannez d''abord le ticket.'); end if;
  if v_t.dish_id is not null then return public._fail('ALREADY_SERVED', 'Plat déjà enregistré pour ce ticket.'); end if;
  if v_t.used_at < now() - interval '30 minutes' then return public._fail('TOO_LATE', 'Ticket scanné il y a plus de 30 minutes.'); end if;

  select mi.*, d.name as dish_name into v_mi
    from public.menu_items mi join public.menus m on m.id = mi.menu_id join public.dishes d on d.id = mi.dish_id
   where mi.id = p_menu_item_id and m.status = 'published'
     and mi.service_date = v_t.service_date and mi.service = v_t.service
     for no key update of mi;
  if not found then return public._fail('WRONG_ITEM', 'Ce plat n''est pas au menu de ce service.'); end if;
  if v_mi.is_sold_out or v_mi.is_full then return public._fail('SOLD_OUT', v_mi.dish_name || ' est épuisé.'); end if;

  update public.tickets set menu_item_id = v_mi.id, dish_id = v_mi.dish_id where id = v_t.id;
  update public.menu_items set sold_qty = sold_qty + 1, served_qty = served_qty + 1 where id = v_mi.id;
  insert into public.stock_movements (ingredient_id, type, qty, reason, menu_item_id, created_by)
  select rl.ingredient_id, 'out', rl.qty_per_portion, 'Portion servie', v_mi.id, v_uid
    from public.recipe_lines rl where rl.dish_id = v_mi.dish_id;
  perform public._notify(v_t.user_id, 'rate_dish', 'Comment était votre ' || lower(split_part(v_mi.dish_name, ' ', 1)) || ' ?',
                         'Notez votre repas et aidez la cuisine à s''améliorer.',
                         jsonb_build_object('ticket_id', v_t.id, 'dish_id', v_mi.dish_id));
  perform public._audit('serve_dish', v_t.id::text, jsonb_build_object('dish', v_mi.dish_name));
  return jsonb_build_object('ok', true, 'dish', v_mi.dish_name,
                            'counters', public.service_counters(v_t.service_date, v_t.service));
end $$;

create or replace function public.rate_ticket(p_ticket_id uuid, p_stars int, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t public.tickets;
begin
  select * into v_t from public.tickets where id = p_ticket_id and user_id = auth.uid();
  if not found then return public._fail('TICKET_NOT_FOUND', 'Ticket introuvable.'); end if;
  if v_t.status <> 'used' or v_t.dish_id is null then
    return public._fail('NOT_USED', 'Vous pourrez noter ce plat après avoir été servi.');
  end if;
  if p_stars is null or p_stars not between 1 and 5 then return public._fail('INVALID_STARS', 'Note de 1 à 5.'); end if;
  insert into public.ratings (ticket_id, user_id, dish_id, stars, comment, author)
  values (v_t.id, v_t.user_id, v_t.dish_id, p_stars, nullif(btrim(left(p_comment, 500)), ''),
          (select split_part(full_name, ' ', 1) from public.profiles where id = v_t.user_id))
  on conflict (ticket_id) do nothing;
  if not found then return public._fail('ALREADY_RATED', 'Vous avez déjà noté ce repas.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ═════════════ Affluence : 4 services ═════════════
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
    'level', case when v_rate < 50 then 'low' when v_rate <= 80 then 'mid' else 'high' end,
    'occupied_tables', coalesce(v_snap.occupied_tables, round(v_rate * v_room.total_tables / 100)),
    'total_tables', v_room.total_tables,
    'wait_min', greatest(0, round(greatest(v_rate - 40, 0) / 5 + v_scans / 6.0))::int,
    'source', v_source, 'updated_at', coalesce(v_snap.created_at, now()));
end $$;

-- ═════════════ Notifications de service ═════════════
create or replace function public.notify_service_events(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_started int := 0; v_expiring int; v_seats int := 0; v_n int;
  v_today date := (p_now at time zone 'Africa/Abidjan')::date;
  v_svc public.service_kind;
  v_win record;
  v_occ jsonb;
  v_key text;
begin
  -- Un service commence : rappel aux clients qui ont un ticket de ce type
  foreach v_svc in array enum_range(null::public.service_kind) loop
    select * into v_win from public.service_window(v_today, v_svc);
    continue when v_win.starts_at is null or not (v_win.starts_at <= p_now and v_win.starts_at > p_now - interval '30 minutes');
    continue when not public._service_on_menu(v_today, v_svc);
    v_key := v_today::text || '-' || v_svc::text;
    insert into notifications (user_id, type, title, body, data)
    select distinct on (t.user_id) t.user_id, 'ticket_valid', 'Le ' || lower(public.service_label(v_svc)) || ' est servi 🍽️',
           'Vous avez un ticket ' || public.service_label(v_svc) || ' : présentez votre QR au comptoir.',
           jsonb_build_object('service_key', v_key)
      from tickets t
     where t.status = 'valid' and t.service = v_svc and t.valid_until > p_now
       and not exists (select 1 from notifications n where n.user_id = t.user_id and n.type = 'ticket_valid' and n.data ->> 'service_key' = v_key);
    get diagnostics v_n = row_count;
    v_started := v_started + v_n;
  end loop;

  -- Expiration dans moins de 3 h
  insert into notifications (user_id, type, title, body, data)
  select t.user_id, 'ticket_expiring', 'Votre ticket expire bientôt ⏳',
         'Ticket ' || public.service_label(t.service) || ' : valable jusqu''à ' || to_char(t.valid_until at time zone 'Africa/Abidjan', 'HH24"h"MI') || '.',
         jsonb_build_object('ticket_id', t.id)
    from tickets t
   where t.status = 'valid' and t.valid_until > p_now and t.valid_until <= p_now + interval '3 hours'
     and not exists (select 1 from notifications n where n.type = 'ticket_expiring' and n.data ->> 'ticket_id' = t.id::text);
  get diagnostics v_expiring = row_count;

  v_occ := public.occupancy_now();
  if v_occ ->> 'status' = 'open' and v_occ ->> 'source' = 'vision' and (v_occ ->> 'rate')::numeric < 50 then
    v_key := v_today::text || '-' || (v_occ ->> 'service');
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

-- ═════════════ Dashboard ═════════════
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
        select jsonb_build_object('kind', 'stock', 'level', 'warn', 'text', 'Stock bas : ' || name || ' (' || trim(to_char(stock_qty, 'FM999990.##')) || ' ' || unit || ')') a
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

-- Prévisions : fréquentation attendue par service (historique des 4 mêmes jours de semaine, au moins les
-- tickets en circulation), répartie entre les plats du menu selon les choix passés au comptoir.
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
      (select avg(h.served_qty) from menu_items h join menus hm on hm.id = h.menu_id
        where hm.status = 'published' and h.dish_id = mi.dish_id and h.service = mi.service
          and h.service_date in (p_date - 7, p_date - 14, p_date - 21, p_date - 28)) dish_hist
      from menu_items mi join menus m on m.id = mi.menu_id join dishes d on d.id = mi.dish_id
     where mi.service_date = p_date
  ), shares as (
    select i.*, s.expected_total, s.basis,
      case when sum(i.dish_hist) over (partition by i.service) > 0
           then coalesce(i.dish_hist, 0) / sum(i.dish_hist) over (partition by i.service)
           else 1.0 / count(*) over (partition by i.service) end share
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
                'basis', case when dish_hist is not null then 'dish' else 'none' end)
                order by service, recommended desc), '[]') from rec),
    'ingredients', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', id, 'name', name, 'unit', unit, 'stock', stock_qty, 'need', need,
                'to_buy', greatest(round(need - stock_qty + alert_threshold, 2), 0),
                'cost', ceil(greatest(need - stock_qty + alert_threshold, 0) * unit_cost)) order by name), '[]') from needs)
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
    'revenue', coalesce((select -sum(amount) from transactions where type in ('purchase', 'refund') and created_at >= t0 and created_at < t1), 0),
    'recharges', coalesce((select sum(amount) from transactions where type in ('recharge', 'recharge_cash') and created_at >= t0 and created_at < t1), 0),
    'transfers', coalesce((select sum(amount) from transactions where type = 'transfer_in' and created_at >= t0 and created_at < t1), 0),
    'tickets', (select count(*) from tickets where created_at >= t0 and created_at < t1 and status <> 'cancelled'),
    'served', (select count(*) from tickets where used_at >= t0 and used_at < t1),
    'expired', (select count(*) from tickets where status = 'expired' and valid_until >= t0 and valid_until < t1),
    'cancelled', (select count(*) from tickets where cancelled_at >= t0 and cancelled_at < t1),
    'by_service', (select coalesce(jsonb_agg(jsonb_build_object('service', service, 'label', public.service_label(service), 'n', n) order by service), '[]')
                     from (select service, count(*)::int n from tickets where created_at >= t0 and created_at < t1 and status <> 'cancelled' group by 1) x),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', g::date,
                 'revenue', coalesce((select -sum(amount) from transactions where type in ('purchase', 'refund')
                                        and created_at >= g::date::timestamp at time zone 'Africa/Abidjan'
                                        and created_at < (g::date + 1)::timestamp at time zone 'Africa/Abidjan'), 0),
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

-- ═════════════ Droits ═════════════
revoke all on function public.purchase_tickets(public.service_kind, int, uuid[], text, uuid, boolean),
  public.serve_dish(uuid, uuid), public._service_dishes(date, public.service_kind), public.service_label(public.service_kind)
  from public, anon;
grant execute on function public.purchase_tickets(public.service_kind, int, uuid[], text, uuid, boolean),
  public.serve_dish(uuid, uuid), public.service_label(public.service_kind) to authenticated;
grant execute on function public.service_label(public.service_kind) to anon;
revoke all on function public._service_dishes(date, public.service_kind) from authenticated;
grant execute on all functions in schema public to service_role;
