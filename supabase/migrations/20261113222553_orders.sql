-- Commandes à heure de retrait (« click & collect »).
-- Le client choisit SON plat + un créneau (ex. 12h30). Le plat est payé et réservé tout de suite ;
-- la cuisine reçoit la commande, la prépare (Reçue → En préparation → Prête) et le client est prévenu quand elle est prête.
-- Il récupère sa commande entre l'heure choisie et la fin du service, au comptoir (QR ou code PIN, comme un ticket).
-- Annulation gratuite (remboursée) jusqu'à 1 h 30 avant le début du service (10h00 pour le déjeuner) et tant que la cuisine
-- n'a pas commencé. Commande non récupérée à la fin du service : plat perdu, PAS de remboursement.
-- Une commande est un ticket (même QR, même comptoir) avec pickup_at renseigné.

alter table public.tickets
  add column if not exists pickup_at   timestamptz,
  add column if not exists order_no    int,
  add column if not exists prep_status text check (prep_status in ('received', 'preparing', 'ready')),
  add column if not exists ready_at    timestamptz;
create index if not exists tickets_orders on public.tickets (pickup_at) where pickup_at is not null;
grant select (pickup_at, order_no, prep_status, ready_at) on public.tickets to authenticated;

insert into public.settings (key, value) values
  ('orders', '{"slot_minutes":15,"slot_capacity":30,"min_lead_minutes":20,"cancel_before_service_minutes":90,"max_days_ahead":7}')
on conflict (key) do nothing;

-- Début / fin d'un service un jour donné (heure d'Abidjan)
create or replace function public._service_window(p_date date, p_service public.service_kind, out starts timestamptz, out ends timestamptz)
language sql stable set search_path = public, pg_temp as $$
  select (p_date + (s ->> 'start')::time) at time zone 'Africa/Abidjan',
         (p_date + (s ->> 'end')::time)   at time zone 'Africa/Abidjan'
    from (select public.setting('services') -> p_service::text as s) x
$$;

-- Heure limite d'annulation d'une commande
create or replace function public._order_cancel_deadline(p_pickup timestamptz, p_service public.service_kind) returns timestamptz
language sql stable set search_path = public, pg_temp as $$
  select w.starts - make_interval(mins => coalesce((public.setting('orders') ->> 'cancel_before_service_minutes')::int, 90))
    from public._service_window((p_pickup at time zone 'Africa/Abidjan')::date, p_service) w
$$;

-- Créneaux proposés au client pour un plat (jour + service), avec les places restantes
create or replace function public.order_slots(p_date date, p_service public.service_kind) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_cfg jsonb := public.setting('orders');
  v_step int := coalesce((v_cfg ->> 'slot_minutes')::int, 15);
  v_cap int := coalesce((v_cfg ->> 'slot_capacity')::int, 30);
  v_lead int := coalesce((v_cfg ->> 'min_lead_minutes')::int, 20);
  w record;
begin
  select * into w from public._service_window(p_date, p_service);
  if w.starts is null then return '[]'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', s, 'left', greatest(v_cap - coalesce(n, 0), 0)) order by s)
      from generate_series(w.starts, w.ends - make_interval(mins => v_step), make_interval(mins => v_step)) s
      left join lateral (select count(*) n from public.tickets t
                          where t.pickup_at = s and t.status in ('valid', 'used')) c on true
     where s >= now() + make_interval(mins => v_lead)), '[]');
end $$;
grant execute on function public.order_slots(date, public.service_kind) to authenticated;

-- Passer une commande : un plat du menu publié + un créneau (+ entrée / dessert facultatifs)
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

  if v_total > coalesce((public.setting('pin_threshold'))::int, 5000) then
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
  perform public._notify_roles('{chef}', 'order_new', 'Nouvelle commande n° ' || v_no || ' 🛎️',
    v_mi.dish_name || coalesce(' + ' || (select string_agg(e ->> 'name', ' + ') from jsonb_array_elements(v_extras) e), '')
      || ' · ' || v_me.full_name || ' · retrait ' || v_when,
    jsonb_build_object('ticket_id', v_id, 'href', '/admin/commandes'));
  perform public._audit('place_order', v_id::text, jsonb_build_object('dish', v_mi.dish_name, 'pickup_at', p_pickup_at));

  return jsonb_build_object('ok', true, 'ticket_id', v_id, 'order_no', v_no, 'total', v_total, 'dish', v_mi.dish_name,
    'pickup_at', p_pickup_at, 'pickup_until', w.ends, 'cancel_until', public._order_cancel_deadline(p_pickup_at, v_mi.service),
    'balance', (select balance from public.wallets where user_id = v_uid));
end $$;
revoke all on function public.place_order(uuid, timestamptz, uuid[], text) from public, anon;
grant execute on function public.place_order(uuid, timestamptz, uuid[], text) to authenticated;

-- Annulation : tickets normaux comme avant ; commandes seulement avant l'heure limite et avant la préparation
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
  if v_t.pickup_at is not null then
    if v_t.prep_status <> 'received' then
      return public._fail('NOT_CANCELLABLE', 'La cuisine prépare déjà votre commande : elle ne peut plus être annulée.');
    end if;
    if now() > public._order_cancel_deadline(v_t.pickup_at, v_t.service) then
      return public._fail('NOT_CANCELLABLE', 'Annulation possible jusqu''à '
        || to_char(public._order_cancel_deadline(v_t.pickup_at, v_t.service) at time zone 'Africa/Abidjan', 'HH24"h"MI') || ' seulement.');
    end if;
    update public.menu_items set sold_qty = greatest(sold_qty - 1, 0) where id = v_t.menu_item_id;
  end if;

  update public.tickets set status = 'cancelled', cancelled_at = now() where id = v_t.id;
  if v_t.total > 0 then
    perform 1 from public.wallets where user_id = v_t.buyer_id for update;
    perform public._wallet_move(v_t.buyer_id, v_t.total, 'refund', p_ticket => v_t.id,
      p_note => case when v_t.pickup_at is not null then 'Annulation commande n° ' || v_t.order_no
                     else 'Annulation ticket ' || public.service_label(v_t.service) end);
  end if;
  if v_t.is_reward then
    update public.profiles set points = points + coalesce((public.setting('loyalty') ->> 'reward_points')::int, 10)
     where id = v_t.buyer_id;
  end if;
  return jsonb_build_object('ok', true, 'refunded', v_t.total,
                            'balance', (select balance from public.wallets where user_id = v_uid));
end $$;

-- Comptoir : une commande ne se retire que le jour prévu, à partir de son créneau (10 min de tolérance),
-- et le plat commandé est enregistré automatiquement (pas de choix de plat pour l'agent).
create or replace function public.redeem_ticket(p_ticket_id uuid, p_nonce text, p_agent_id uuid,
                                                p_service_date date, p_service public.service_kind)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_t public.tickets;
  v_agent public.profiles;
  v_client text;
  v_by text;
  v_buyer text;
  v_batch int;
  v_remaining int;
  v_dish text;
begin
  select * into v_agent from public.profiles where id = p_agent_id;
  if not found or v_agent.is_blocked or v_agent.role not in ('agent', 'admin') then
    return public._fail('FORBIDDEN', 'Compte agent requis.');
  end if;

  -- Commande : bon jour et créneau atteint (vérifié avant l'UPDATE)
  select * into v_t from public.tickets where id = p_ticket_id and qr_nonce = p_nonce and status = 'valid';
  if found and v_t.pickup_at is not null then
    if (v_t.pickup_at at time zone 'Africa/Abidjan')::date <> p_service_date then
      return public._fail('WRONG_DAY', 'Commande n° ' || v_t.order_no || ' prévue ' || public._day_label((v_t.pickup_at at time zone 'Africa/Abidjan')::date)
        || ' à ' || to_char(v_t.pickup_at at time zone 'Africa/Abidjan', 'HH24"h"MI') || '.');
    end if;
    if now() < v_t.pickup_at - interval '10 minutes' and coalesce(v_t.prep_status, '') <> 'ready' then
      return public._fail('TOO_EARLY', 'Commande n° ' || v_t.order_no || ' prévue à '
        || to_char(v_t.pickup_at at time zone 'Africa/Abidjan', 'HH24"h"MI') || ' : pas encore prête.');
    end if;
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
      return public._fail('EXPIRED', case when v_t.pickup_at is not null then 'Commande non récupérée à temps (fin du service).'
        else 'Ticket expiré le ' || to_char(v_t.valid_until at time zone 'Africa/Abidjan', 'DD/MM "à" HH24"h"MI') || '.' end);
    else
      return public._fail('WRONG_SERVICE', 'Ticket ' || public.service_label(v_t.service) || ' : pas valable pour le '
        || lower(public.service_label(p_service)) || '.', jsonb_build_object('service', v_t.service));
    end if;
  end if;

  update public.profiles set points = points + coalesce((public.setting('loyalty') ->> 'points_per_ticket')::int, 1)
   where id = v_t.user_id returning full_name into v_client;
  perform public._audit('redeem_ticket', v_t.id::text, jsonb_build_object('service', v_t.service), p_agent_id);

  -- Commande : le plat commandé est servi (portion déjà réservée, sortie de stock maintenant)
  if v_t.pickup_at is not null then
    update public.tickets set dish_id = mi.dish_id from public.menu_items mi where mi.id = v_t.menu_item_id and tickets.id = v_t.id;
    update public.menu_items set served_qty = served_qty + 1 where id = v_t.menu_item_id;
    insert into public.stock_movements (ingredient_id, type, qty, reason, menu_item_id, created_by)
    select rl.ingredient_id, 'out', rl.qty_per_portion, 'Commande servie', mi.id, p_agent_id
      from public.menu_items mi join public.recipe_lines rl on rl.dish_id = mi.dish_id where mi.id = v_t.menu_item_id;
    select d.name into v_dish from public.menu_items mi join public.dishes d on d.id = mi.dish_id where mi.id = v_t.menu_item_id;
    return jsonb_build_object('ok', true, 'ticket_id', v_t.id, 'client', v_client,
      'ticket', public.service_label(v_t.service), 'service', v_t.service, 'extras', v_t.extras, 'used_at', v_t.used_at,
      'order', jsonb_build_object('no', v_t.order_no, 'dish', v_dish, 'pickup_at', v_t.pickup_at, 'ready', v_t.prep_status = 'ready'),
      'dishes', '[]'::jsonb, 'counters', public.service_counters(p_service_date, p_service));
  end if;

  select count(*) into v_batch from public.tickets
   where buyer_id = v_t.buyer_id and service = v_t.service and created_at = v_t.created_at;
  select count(*) into v_remaining from public.tickets
   where user_id = v_t.user_id and service = v_t.service and status = 'valid' and valid_until > now() and pickup_at is null;
  if v_t.buyer_id <> v_t.user_id then select full_name into v_buyer from public.profiles where id = v_t.buyer_id; end if;

  return jsonb_build_object('ok', true, 'ticket_id', v_t.id, 'client', v_client,
    'ticket', public.service_label(v_t.service), 'service', v_t.service, 'extras', v_t.extras, 'used_at', v_t.used_at,
    'batch_size', v_batch, 'remaining', v_remaining, 'gift_from', v_buyer, 'is_reward', v_t.is_reward,
    'dishes', public._service_dishes(p_service_date, p_service),
    'counters', public.service_counters(p_service_date, p_service));
end $$;

-- Sans téléphone (code + PIN) : la commande du jour passe en priorité, sinon le ticket qui expire le plus tôt.
-- On ne remplace que la sélection du ticket : le reste (PIN, alertes) est inchangé.
create or replace function public.redeem_with_pin(p_short_code text, p_pin text, p_service_date date, p_service public.service_kind,
                                       p_lost_phone boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_agent uuid := auth.uid();
  v_agent_name text;
  v_user public.profiles;
  v_err text;
  v_t public.tickets;
  v_res jsonb;
  v_other text;
begin
  if not public.has_role('agent') then return public._fail('FORBIDDEN', 'Compte agent requis.'); end if;
  if (select count(*) from public.audit_log
       where actor_id = v_agent and action = 'counter_pin_failed' and created_at > now() - interval '1 hour') >= 10 then
    return public._fail('AGENT_THROTTLED', 'Trop de codes PIN faux sur ce scanner. Demandez le QR ou réessayez dans une heure.');
  end if;

  select * into v_user from public.profiles where short_code = upper(btrim(p_short_code));
  if not found or v_user.is_blocked then return public._fail('NOT_FOUND', 'Client introuvable.'); end if;
  if v_user.pin_hash is null then
    return public._fail('PIN_NOT_SET', 'Ce client n''a pas de code PIN : il doit présenter son QR (au besoin depuis un autre téléphone).');
  end if;
  if v_user.pin_locked_until > now() then
    return public._fail('PIN_LOCKED', 'Code PIN bloqué jusqu''à ' || to_char(v_user.pin_locked_until at time zone 'Africa/Abidjan', 'HH24"h"MI') || ' (trop d''essais).',
      jsonb_build_object('locked_until', v_user.pin_locked_until));
  end if;

  select * into v_t from public.tickets
   where user_id = v_user.id and status = 'valid' and service = p_service and valid_until > now()
     and (pickup_at is null or (pickup_at at time zone 'Africa/Abidjan')::date = p_service_date)
   order by (pickup_at is null), valid_until, created_at limit 1
   for update skip locked;
  if not found then
    select string_agg(public.service_label(service) || ' × ' || n, ', ') into v_other from (
      select service, count(*) n from public.tickets
       where user_id = v_user.id and status = 'valid' and valid_until > now() group by service) s;
    return public._fail('NO_TICKET', 'Aucun ticket ' || public.service_label(p_service) || ' valide pour ' || v_user.full_name || '.'
      || coalesce(' Il a : ' || v_other || '.', ''));
  end if;

  v_err := public._check_pin(v_user.id, p_pin);
  if v_err is not null then
    perform public._audit('counter_pin_failed', v_user.id::text, jsonb_build_object('code', v_err), v_agent);
    if v_err = 'PIN_LOCKED' then
      perform public._notify(v_user.id, 'pin_alert', 'Code PIN bloqué',
        '3 codes PIN faux au comptoir de la cantine. Si ce n''était pas vous, changez votre code PIN.', jsonb_build_object('href', '/app/profil'));
      return public._fail(v_err, 'Trois codes faux : PIN bloqué 15 minutes. Le client a été prévenu.');
    end if;
    return public._fail('PIN_INVALID', 'Code PIN incorrect.', jsonb_build_object('attempts_left',
      3 - (select pin_failed_attempts from public.profiles where id = v_user.id)));
  end if;

  v_res := public.redeem_ticket(v_t.id, v_t.qr_nonce, v_agent, p_service_date, p_service);
  if not coalesce((v_res ->> 'ok')::boolean, false) then return v_res; end if;

  update public.tickets set redeem_method = 'pin' where id = v_t.id;
  select full_name into v_agent_name from public.profiles where id = v_agent;
  perform public._audit('redeem_with_pin', v_t.id::text, jsonb_build_object('client', v_user.id, 'lost_phone', p_lost_phone), v_agent);
  perform public._notify(v_user.id, 'ticket_pin', 'Ticket validé sans QR',
    'Ticket ' || public.service_label(p_service) || ' validé avec votre code PIN par ' || coalesce(v_agent_name, 'l''agent') || ' à '
      || to_char(now() at time zone 'Africa/Abidjan', 'HH24"h"MI') || '. Ce n''était pas vous ? Changez votre code PIN et prévenez la cantine.',
    jsonb_build_object('href', '/app/tickets/' || v_t.id));
  if p_lost_phone then
    perform public._secure_account(v_user.id);
    v_res := v_res || jsonb_build_object('secured', true);
  end if;
  return v_res || jsonb_build_object('method', 'pin', 'short_code', v_user.short_code, 'avatar', v_user.avatar, 'user_id', v_user.id);
end $$;

-- Fin du service : ticket normal non utilisé → remboursé ; commande non récupérée → plat perdu (pas de remboursement)
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
    if v_t.pickup_at is not null then
      perform public._notify(v_t.user_id, 'order_missed', 'Commande n° ' || v_t.order_no || ' non récupérée',
        'Le service est terminé : la commande était préparée pour vous, elle n''est pas remboursée.',
        jsonb_build_object('ticket_id', v_t.id));
      continue;
    end if;
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

  -- Rappel 3 h avant l'expiration (tickets normaux, une seule fois par ticket)
  with due as (
    update public.tickets set expiry_reminded_at = now()
     where status = 'valid' and expiry_reminded_at is null and pickup_at is null
       and valid_until > now() and valid_until <= now() + interval '3 hours'
    returning id, user_id, service, valid_until
  )
  insert into public.notifications (user_id, type, title, body, data)
  select user_id, 'ticket_expiring', 'Ton ticket ' || public.service_label(service) || ' expire bientôt',
         'Il expire à ' || to_char(valid_until at time zone 'Africa/Abidjan', 'HH24"h"MI')
         || '. Viens manger ! Sinon, il te sera remboursé automatiquement.', jsonb_build_object('ticket_id', id)
    from due;

  -- Commande prête depuis 45 min et toujours pas récupérée : rappel (une fois)
  with due as (
    update public.tickets set expiry_reminded_at = now()
     where status = 'valid' and pickup_at is not null and expiry_reminded_at is null
       and prep_status = 'ready' and ready_at <= now() - interval '45 minutes'
    returning id, user_id, order_no, valid_until
  )
  insert into public.notifications (user_id, type, title, body, data)
  select user_id, 'order_reminder', 'Ta commande n° ' || order_no || ' t''attend 🍽️',
         'À récupérer avant ' || to_char(valid_until at time zone 'Africa/Abidjan', 'HH24"h"MI') || ', sinon elle sera perdue.',
         jsonb_build_object('ticket_id', id, 'href', '/app/tickets/' || id)
    from due;
  return v_count;
end $$;

-- ═════════════ Cuisine ═════════════
-- Commandes d'un jour (chef, admin, agent) : à préparer, prêtes, récupérées
create or replace function public.kitchen_orders(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_date date := coalesce(p_date, public.today_abidjan());
begin
  if not (public.has_role('chef') or public.has_role('agent')) then return public._fail('FORBIDDEN', 'Réservé à la cuisine.'); end if;
  return jsonb_build_object('ok', true, 'date', v_date, 'orders', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'no', t.order_no, 'client', p.full_name, 'short_code', p.short_code, 'avatar', p.avatar, 'user_id', p.id,
             'dish', d.name, 'photo_url', d.photo_url, 'extras', t.extras, 'service', t.service,
             'pickup_at', t.pickup_at, 'prep_status', t.prep_status, 'status', t.status, 'ready_at', t.ready_at,
             'used_at', t.used_at, 'created_at', t.created_at)
           order by t.pickup_at, t.order_no)
      from public.tickets t
      join public.profiles p on p.id = t.user_id
      join public.menu_items mi on mi.id = t.menu_item_id
      join public.dishes d on d.id = mi.dish_id
     where t.pickup_at is not null and t.status <> 'cancelled'
       and (t.pickup_at at time zone 'Africa/Abidjan')::date = v_date), '[]'::jsonb));
end $$;
grant execute on function public.kitchen_orders(date) to authenticated;

-- La cuisine fait avancer une commande : En préparation → Prête (le client est prévenu)
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
