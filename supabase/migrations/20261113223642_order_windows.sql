-- Commandes : horaires d'ouverture fixés par la cuisine, pause, notifications de suivi, sécurité renforcée.
-- - La cuisine règle, par repas, la plage où l'on peut commander pour le jour même (ex. déjeuner : 12h00 → 13h00)
--   et peut mettre les commandes en pause. Les précommandes pour les jours suivants restent possibles à tout moment.
-- - Suivi : « Commande reçue » → « La cuisine prépare » → « Prête » (notification à chaque étape).
-- - Sécurité : chaque commande est confirmée par le code PIN (ou Face ID), au plus 2 commandes en cours par repas,
--   le chef ET les agents du comptoir sont prévenus.

update public.settings
   set value = value || jsonb_build_object(
         'pin_always', true,
         'max_active_per_meal', 2,
         'windows', coalesce(value -> 'windows', '{"lunch":{"open":"12:00","close":"13:00","paused":false}}'::jsonb))
 where key = 'orders';

create or replace function public.place_order(p_menu_item_id uuid, p_pickup_at timestamptz,
                                              p_extra_ids uuid[] default '{}', p_pin text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles;
  v_cfg jsonb := public.setting('orders');
  v_mi record;
  v_svc jsonb;
  w record;
  v_step int := coalesce((v_cfg ->> 'slot_minutes')::int, 15);
  v_extras jsonb := '[]';
  v_total int;
  v_err text;
  v_balance int;
  v_no int;
  v_id uuid;
  v_label text;
  v_when text;
  v_win jsonb;
  v_now_t time := (now() at time zone 'Africa/Abidjan')::time;
begin
  if v_uid is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  select * into v_me from public.profiles where id = v_uid;
  if v_me.is_blocked then return public._fail('ACCOUNT_BLOCKED', 'Votre compte est bloqué.'); end if;

  -- Plat au menu publié ; verrouillé pour la réservation de la portion
  select mi.*, d.name as dish_name into v_mi
    from public.menu_items mi join public.menus m on m.id = mi.menu_id join public.dishes d on d.id = mi.dish_id
   where mi.id = p_menu_item_id and m.status = 'published'
     for no key update of mi;
  if not found then return public._fail('WRONG_ITEM', 'Ce plat n''est pas au menu.'); end if;
  if v_mi.is_sold_out or v_mi.is_full then return public._fail('SOLD_OUT', v_mi.dish_name || ' est épuisé.'); end if;
  if v_mi.service_date > public.today_abidjan() + coalesce((v_cfg ->> 'max_days_ahead')::int, 7) then
    return public._fail('TOO_EARLY', 'Commande possible au plus ' || coalesce(v_cfg ->> 'max_days_ahead', '7') || ' jours à l''avance.');
  end if;

  -- Créneau : dans le service de ce jour, sur un pas de 15 min, assez tard pour que la cuisine prépare, pas complet
  -- Horaires de commande fixés par la cuisine (commandes du jour) ; pause possible à tout moment
  v_win := v_cfg -> 'windows' -> v_mi.service::text;
  if coalesce((v_win ->> 'paused')::boolean, false) then
    return public._fail('ORDERS_PAUSED', 'La cuisine a mis les commandes du ' || lower(public.service_label(v_mi.service)) || ' en pause. Réessayez plus tard.');
  end if;
  if v_mi.service_date = public.today_abidjan() and v_win ->> 'open' is not null and v_win ->> 'close' is not null
     and (v_now_t < (v_win ->> 'open')::time or v_now_t >= (v_win ->> 'close')::time) then
    return public._fail('ORDERS_CLOSED', 'Commandes du ' || lower(public.service_label(v_mi.service)) || ' : de '
      || replace(v_win ->> 'open', ':', 'h') || ' à ' || replace(v_win ->> 'close', ':', 'h') || '.'
      || case when v_now_t < (v_win ->> 'open')::time then ' Revenez à ' || replace(v_win ->> 'open', ':', 'h') || '.' else ' C''est fermé pour aujourd''hui.' end);
  end if;
  -- Anti-abus : nombre de commandes en cours limité par repas
  if (select count(*) from public.tickets
       where user_id = v_uid and pickup_at is not null and status = 'valid' and service = v_mi.service
         and (pickup_at at time zone 'Africa/Abidjan')::date = v_mi.service_date)
     >= coalesce((v_cfg ->> 'max_active_per_meal')::int, 2) then
    return public._fail('TOO_MANY_ORDERS', 'Vous avez déjà ' || coalesce(v_cfg ->> 'max_active_per_meal', '2') || ' commandes pour ce repas.');
  end if;

  select * into w from public._service_window(v_mi.service_date, v_mi.service);
  if p_pickup_at is null or p_pickup_at < w.starts or p_pickup_at >= w.ends
     or extract(epoch from (p_pickup_at - w.starts))::int % (v_step * 60) <> 0 then
    return public._fail('INVALID_SLOT', 'Créneau invalide.');
  end if;
  if p_pickup_at < now() + make_interval(mins => coalesce((v_cfg ->> 'min_lead_minutes')::int, 20)) then
    return public._fail('SLOT_TOO_SOON', 'Ce créneau est trop proche : la cuisine a besoin d''au moins '
      || coalesce(v_cfg ->> 'min_lead_minutes', '20') || ' minutes.');
  end if;
  perform pg_advisory_xact_lock(hashtext('order-slot:' || p_pickup_at::text));
  if (select count(*) from public.tickets where pickup_at = p_pickup_at and status in ('valid', 'used'))
     >= coalesce((v_cfg ->> 'slot_capacity')::int, 30) then
    return public._fail('SLOT_FULL', 'Ce créneau est complet, choisissez-en un autre.');
  end if;

  -- Suppléments : au plus une entrée et un dessert, si le service les autorise
  v_svc := public.setting('services') -> v_mi.service::text;
  if cardinality(coalesce(p_extra_ids, '{}')) > 0 then
    if not coalesce((v_svc ->> 'extras')::boolean, false) then
      return public._fail('EXTRAS_NOT_ALLOWED', 'Pas de supplément pour ce repas.');
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'kind', x.kind, 'price', x.price) order by x.kind desc), '[]')
      into v_extras from public.extras x where x.id = any (p_extra_ids) and x.is_active and x.kind in ('starter', 'dessert');
    if jsonb_array_length(v_extras) <> cardinality(p_extra_ids)
       or (select count(*) from jsonb_array_elements(v_extras) e group by e ->> 'kind' order by 1 desc limit 1) > 1 then
      return public._fail('INVALID_EXTRA', 'Au plus une entrée et un dessert.');
    end if;
  end if;
  v_total := v_mi.price + coalesce((select sum((e ->> 'price')::int) from jsonb_array_elements(v_extras) e), 0);

  -- Sécurité : toute commande est confirmée par le titulaire (code PIN, ou Face ID quand il est activé)
  if coalesce((v_cfg ->> 'pin_always')::boolean, true) or v_total > coalesce((public.setting('pin_threshold'))::int, 5000) then
    v_err := public._check_pin(v_uid, p_pin);
    if v_err is not null then return public._pin_fail(v_err); end if;
  end if;
  select balance into v_balance from public.wallets where user_id = v_uid for update;
  if v_balance < v_total then
    return public._fail('INSUFFICIENT_FUNDS', 'Solde insuffisant.', jsonb_build_object('balance', v_balance, 'total', v_total));
  end if;

  -- Numéro de commande du jour (1, 2, 3…)
  perform pg_advisory_xact_lock(hashtext('order-no:' || v_mi.service_date::text));
  select coalesce(max(order_no), 0) + 1 into v_no from public.tickets
   where pickup_at is not null and (pickup_at at time zone 'Africa/Abidjan')::date = v_mi.service_date;

  insert into public.tickets (user_id, buyer_id, service, menu_item_id, extras, total, valid_from, valid_until,
                              pickup_at, order_no, prep_status)
  values (v_uid, v_uid, v_mi.service, v_mi.id, v_extras, v_total, now(), w.ends, p_pickup_at, v_no, 'received')
  returning id into v_id;
  update public.menu_items set sold_qty = sold_qty + 1 where id = v_mi.id;   -- portion réservée

  v_label := public.service_label(v_mi.service);
  v_when := public._day_label(v_mi.service_date) || ' à ' || to_char(p_pickup_at at time zone 'Africa/Abidjan', 'HH24"h"MI');
  perform public._wallet_move(v_uid, -v_total, 'purchase', p_ticket => v_id,
    p_note => 'Commande n° ' || v_no || ' · ' || v_mi.dish_name
              || coalesce(' + ' || (select string_agg(e ->> 'name', ' + ') from jsonb_array_elements(v_extras) e), ''));
  -- La cuisine est prévenue tout de suite (écran Commandes + notification)
  perform public._notify_roles('{chef,agent}', 'order_new', 'Nouvelle commande n° ' || v_no || ' 🛎️',
    v_mi.dish_name || coalesce(' + ' || (select string_agg(e ->> 'name', ' + ') from jsonb_array_elements(v_extras) e), '')
      || ' · ' || v_me.full_name || ' · retrait ' || v_when,
    jsonb_build_object('ticket_id', v_id, 'href', '/admin/commandes'));
  perform public._audit('place_order', v_id::text, jsonb_build_object('dish', v_mi.dish_name, 'pickup_at', p_pickup_at));
  perform public._notify(v_uid, 'order_placed', 'Commande n° ' || v_no || ' bien reçue ✅',
    v_mi.dish_name || ' · retrait ' || v_when || '. On te prévient quand la cuisine la prépare, puis quand elle est prête.',
    jsonb_build_object('ticket_id', v_id, 'href', '/app/tickets/' || v_id));

  return jsonb_build_object('ok', true, 'ticket_id', v_id, 'order_no', v_no, 'total', v_total, 'dish', v_mi.dish_name,
    'pickup_at', p_pickup_at, 'pickup_until', w.ends, 'cancel_until', public._order_cancel_deadline(p_pickup_at, v_mi.service),
    'balance', (select balance from public.wallets where user_id = v_uid));
end $$;
revoke all on function public.place_order(uuid, timestamptz, uuid[], text) from public, anon;
grant execute on function public.place_order(uuid, timestamptz, uuid[], text) to authenticated;

create or replace function public.set_order_status(p_ticket_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t public.tickets; v_dish text;
begin
  if not (public.has_role('chef') or public.has_role('agent')) then return public._fail('FORBIDDEN', 'Réservé à la cuisine.'); end if;
  if p_status not in ('received', 'preparing', 'ready') then return public._fail('INVALID_STATUS', 'Statut inconnu.'); end if;
  select * into v_t from public.tickets where id = p_ticket_id and pickup_at is not null for no key update;
  if not found then return public._fail('NOT_FOUND', 'Commande introuvable.'); end if;
  if v_t.status <> 'valid' then return public._fail('INVALID_STATUS', 'Commande déjà récupérée ou terminée.'); end if;
  if v_t.prep_status = p_status then return jsonb_build_object('ok', true); end if;

  update public.tickets set prep_status = p_status, ready_at = case when p_status = 'ready' then now() end where id = v_t.id;
  if p_status = 'preparing' then
    select d.name into v_dish from public.menu_items mi join public.dishes d on d.id = mi.dish_id where mi.id = v_t.menu_item_id;
    perform public._notify(v_t.user_id, 'order_preparing', 'La cuisine prépare ta commande n° ' || v_t.order_no || ' 👨‍🍳',
      v_dish || ' est en préparation. Retrait à ' || to_char(v_t.pickup_at at time zone 'Africa/Abidjan', 'HH24"h"MI') || '.',
      jsonb_build_object('ticket_id', v_t.id, 'href', '/app/tickets/' || v_t.id));
  end if;
  if p_status = 'ready' then
    select d.name into v_dish from public.menu_items mi join public.dishes d on d.id = mi.dish_id where mi.id = v_t.menu_item_id;
    perform public._notify(v_t.user_id, 'order_ready', 'Ta commande n° ' || v_t.order_no || ' est prête 🍽️',
      v_dish || ' t''attend au comptoir. À récupérer avant ' || to_char(v_t.valid_until at time zone 'Africa/Abidjan', 'HH24"h"MI') || '.',
      jsonb_build_object('ticket_id', v_t.id, 'href', '/app/tickets/' || v_t.id));
  end if;
  perform public._audit('order_status', v_t.id::text, jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.set_order_status(uuid, text) from public, anon;
grant execute on function public.set_order_status(uuid, text) to authenticated;

-- Réglages de commande par la cuisine (chef ou admin) : plage horaire et pause d'un repas
create or replace function public.set_order_window(p_service public.service_kind, p_open text, p_close text, p_paused boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_win jsonb;
begin
  if not public.has_role('chef') then return public._fail('FORBIDDEN', 'Réservé à la cuisine.'); end if;
  if (p_open is null) <> (p_close is null) then return public._fail('INVALID_WINDOW', 'Indiquez l''ouverture et la fermeture.'); end if;
  if p_open is not null and (p_open !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_close !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_open::time >= p_close::time) then
    return public._fail('INVALID_WINDOW', 'Horaires invalides : l''ouverture doit être avant la fermeture.');
  end if;
  v_win := jsonb_build_object('open', p_open, 'close', p_close, 'paused', coalesce(p_paused, false));
  update public.settings
     set value = jsonb_set(value, array['windows', p_service::text], v_win, true), updated_at = now()
   where key = 'orders';
  perform public._audit('set_order_window', p_service::text, v_win);
  return jsonb_build_object('ok', true, 'window', v_win);
end $$;
revoke all on function public.set_order_window(public.service_kind, text, text, boolean) from public, anon;
grant execute on function public.set_order_window(public.service_kind, text, text, boolean) to authenticated;
