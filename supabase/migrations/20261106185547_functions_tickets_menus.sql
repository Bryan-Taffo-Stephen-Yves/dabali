-- Dabali — RPC tickets, menus, stock, administration

-- ═════════════════════════════ Tickets ═════════════════════════════

create function public.purchase_ticket(p_menu_item_id uuid, p_extra_ids uuid[] default '{}', p_pin text default null,
                                       p_beneficiary_id uuid default null, p_use_reward boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles;
  v_for uuid := coalesce(p_beneficiary_id, auth.uid());
  v_item record;
  v_win record;
  v_extras jsonb := '[]';
  v_extra_count int;
  v_reward_pts int := coalesce((public.setting('loyalty') ->> 'reward_points')::int, 10);
  v_reward_used boolean := false;
  v_total int;
  v_err text;
  v_balance int;
  v_ticket public.tickets;
  v_tx public.transactions;
begin
  if v_uid is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  select * into v_me from public.profiles where id = v_uid;
  if v_me.is_blocked then return public._fail('ACCOUNT_BLOCKED', 'Votre compte est bloqué.'); end if;
  if v_for <> v_uid and not exists (select 1 from public.profiles where id = v_for and not is_blocked) then
    return public._fail('RECIPIENT_NOT_FOUND', 'Bénéficiaire introuvable.');
  end if;

  -- Verrou sur la ligne du menu : empêche la survente quand il reste 1 portion
  select mi.*, m.status as menu_status, d.name as dish_name, d.is_active as dish_active
    into v_item
    from public.menu_items mi
    join public.menus m on m.id = mi.menu_id
    join public.dishes d on d.id = mi.dish_id
   where mi.id = p_menu_item_id
     for no key update of mi;
  if not found then return public._fail('ITEM_NOT_FOUND', 'Plat introuvable.'); end if;
  if v_item.menu_status <> 'published' then return public._fail('MENU_NOT_PUBLISHED', 'Ce menu n''est pas encore publié.'); end if;
  if v_item.is_sold_out or v_item.is_full or not v_item.dish_active then
    return public._fail('SOLD_OUT', v_item.dish_name || ' est épuisé.');
  end if;
  select * into v_win from public.service_window(v_item.service_date, v_item.service);
  if now() >= v_win.ends_at then return public._fail('SERVICE_OVER', 'Ce service est terminé.'); end if;
  if v_item.service_date > public.today_abidjan() + coalesce((public.setting('presale_days'))::int, 7) then
    return public._fail('TOO_EARLY', 'Achat possible au maximum 7 jours à l''avance.');
  end if;

  -- Options (le 1er dessert est offert si l'utilisateur échange ses points)
  p_extra_ids := coalesce(p_extra_ids, '{}');
  if cardinality(p_extra_ids) > 5 then return public._fail('INVALID_EXTRA', 'Trop d''options.'); end if;
  select count(*) into v_extra_count from public.extras where id = any (p_extra_ids) and is_active;
  if v_extra_count <> (select count(distinct x) from unnest(p_extra_ids) x) then
    return public._fail('INVALID_EXTRA', 'Option indisponible.');
  end if;
  if p_use_reward then
    if v_me.points < v_reward_pts then
      return public._fail('REWARD_UNAVAILABLE', 'Il vous faut ' || v_reward_pts || ' points pour un dessert offert.');
    end if;
    if not exists (select 1 from public.extras where id = any (p_extra_ids) and kind = 'dessert') then
      return public._fail('REWARD_UNAVAILABLE', 'Choisissez un dessert pour utiliser votre récompense.');
    end if;
    v_reward_used := true;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'kind', e.kind, 'price', e.price,
                                               'free', v_reward_used and e.rn = 1 and e.kind = 'dessert')
                            order by e.sort, e.name), '[]')
    into v_extras
    from (select x.*, row_number() over (partition by x.kind order by x.price desc, x.id) as rn
            from public.extras x where x.id = any (p_extra_ids)) e;
  v_total := v_item.price + coalesce((select sum((e ->> 'price')::int) from jsonb_array_elements(v_extras) e
                                       where not (e ->> 'free')::boolean), 0);

  -- PIN : au-delà du seuil, ou quand on offre un repas
  if v_total > coalesce((public.setting('pin_threshold'))::int, 5000) or v_for <> v_uid then
    v_err := public._check_pin(v_uid, p_pin);
    if v_err is not null then return public._pin_fail(v_err); end if;
  end if;

  select balance into v_balance from public.wallets where user_id = v_uid for update;
  if v_balance < v_total then
    return public._fail('INSUFFICIENT_FUNDS', 'Solde insuffisant.',
                        jsonb_build_object('balance', v_balance, 'total', v_total));
  end if;

  -- ── Écritures ──
  insert into public.tickets (user_id, buyer_id, menu_item_id, dish_id, extras, total,
                              service_date, service, valid_from, valid_until)
  values (v_for, v_uid, v_item.id, v_item.dish_id, v_extras, v_total,
          v_item.service_date, v_item.service, v_win.starts_at, v_win.ends_at)
  returning * into v_ticket;

  v_tx := public._wallet_move(v_uid, -v_total, 'purchase', p_ticket => v_ticket.id,
                              p_counterpart => nullif(v_for, v_uid), p_note => v_item.dish_name);
  update public.menu_items set sold_qty = sold_qty + 1 where id = v_item.id;
  if v_reward_used then
    update public.profiles set points = points - v_reward_pts where id = v_uid;
  end if;
  if v_for <> v_uid then
    perform public._notify(v_for, 'meal_gift', 'Un repas vous est offert 🎁',
      v_me.full_name || ' vous offre : ' || v_item.dish_name || '.', jsonb_build_object('ticket_id', v_ticket.id));
  end if;

  return jsonb_build_object('ok', true, 'ticket_id', v_ticket.id, 'total', v_total,
                            'balance', v_tx.balance_after, 'reward_used', v_reward_used);
end $$;

create function public.cancel_ticket(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tickets;
  v_cutoff int := coalesce((public.setting('cancel_cutoff_minutes'))::int, 60);
  v_tx public.transactions;
begin
  if v_uid is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  select * into v_t from public.tickets where id = p_ticket_id and v_uid in (user_id, buyer_id) for no key update;
  if not found then return public._fail('TICKET_NOT_FOUND', 'Ticket introuvable.'); end if;
  if v_t.status <> 'valid' then return public._fail('NOT_CANCELLABLE', 'Ce ticket ne peut plus être annulé.'); end if;
  if now() > v_t.valid_from - make_interval(mins => v_cutoff) then
    return public._fail('CANCEL_TOO_LATE', 'Annulation possible jusqu''à ' || v_cutoff || ' min avant le début du service.');
  end if;

  update public.tickets set status = 'cancelled', cancelled_at = now() where id = v_t.id;
  update public.menu_items set sold_qty = greatest(sold_qty - 1, 0) where id = v_t.menu_item_id;
  perform 1 from public.wallets where user_id = v_t.buyer_id for update;
  v_tx := public._wallet_move(v_t.buyer_id, v_t.total, 'refund', p_ticket => v_t.id, p_note => 'Annulation');
  if exists (select 1 from jsonb_array_elements(v_t.extras) e where (e ->> 'free')::boolean) then
    update public.profiles set points = points + coalesce((public.setting('loyalty') ->> 'reward_points')::int, 10)
     where id = v_t.buyer_id;
  end if;
  return jsonb_build_object('ok', true, 'refunded', v_t.total,
                            'balance', (select balance from public.wallets where user_id = v_uid));
end $$;

-- Compteur d'un service : vendus (hors annulés) / servis
create function public.service_counters(p_date date, p_service public.service_kind) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'sold',   coalesce(sum(mi.sold_qty), 0),
    'served', coalesce(sum(mi.served_qty), 0))
  from public.menu_items mi join public.menus m on m.id = mi.menu_id
  where mi.service_date = p_date and mi.service = p_service and m.status = 'published'
$$;

-- Validation d'un ticket au comptoir. Exécutable UNIQUEMENT par service_role, c.-à-d. par l'Edge Function
-- redeem-ticket après vérification de la signature HMAC et du rôle de l'agent.
create function public.redeem_ticket(p_ticket_id uuid, p_nonce text, p_agent_id uuid,
                                     p_service_date date, p_service public.service_kind)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_t public.tickets;
  v_agent public.profiles;
  v_dish text;
  v_client text;
  v_by text;
begin
  select * into v_agent from public.profiles where id = p_agent_id;
  if not found or v_agent.is_blocked or v_agent.role not in ('agent', 'admin') then
    return public._fail('FORBIDDEN', 'Compte agent requis.');
  end if;

  -- Mise à jour atomique : une seule transaction peut faire passer valid → used.
  update public.tickets
     set status = 'used', used_at = now(), scanned_by = p_agent_id
   where id = p_ticket_id and qr_nonce = p_nonce and status = 'valid'
     and service_date = p_service_date and service = p_service and now() < valid_until
  returning * into v_t;

  if not found then
    select * into v_t from public.tickets where id = p_ticket_id;
    if not found or v_t.qr_nonce <> p_nonce then
      return public._fail('INVALID_QR', 'QR invalide.');
    elsif v_t.status = 'used' then
      select full_name into v_by from public.profiles where id = v_t.scanned_by;
      return public._fail('ALREADY_USED',
        'Déjà utilisé à ' || to_char(v_t.used_at at time zone 'Africa/Abidjan', 'HH24"h"MI') || ' par ' || coalesce(v_by, '?') || '.',
        jsonb_build_object('used_at', v_t.used_at, 'scanned_by', v_by));
    elsif v_t.status = 'cancelled' then
      return public._fail('CANCELLED', 'Ticket annulé (remboursé).');
    elsif v_t.status = 'expired' or now() >= v_t.valid_until then
      return public._fail('EXPIRED', 'Ticket expiré.');
    else
      return public._fail('WRONG_SERVICE', 'Mauvais service : ticket pour le '
        || case v_t.service when 'lunch' then 'déjeuner' else 'dîner' end
        || ' du ' || to_char(v_t.service_date, 'DD/MM') || '.',
        jsonb_build_object('service_date', v_t.service_date, 'service', v_t.service));
    end if;
  end if;

  -- Effets du service
  update public.menu_items set served_qty = served_qty + 1 where id = v_t.menu_item_id;
  update public.profiles set points = points + coalesce((public.setting('loyalty') ->> 'points_per_ticket')::int, 1)
   where id = v_t.user_id returning full_name into v_client;
  insert into public.stock_movements (ingredient_id, type, qty, reason, menu_item_id, created_by)
  select rl.ingredient_id, 'out', rl.qty_per_portion, 'Portion servie', v_t.menu_item_id, p_agent_id
    from public.recipe_lines rl where rl.dish_id = v_t.dish_id;
  select name into v_dish from public.dishes where id = v_t.dish_id;
  perform public._notify(v_t.user_id, 'rate_dish', 'Comment était votre ' || lower(split_part(v_dish, ' ', 1)) || ' ?',
                         'Notez votre repas et aidez la cuisine à s''améliorer.',
                         jsonb_build_object('ticket_id', v_t.id, 'dish_id', v_t.dish_id));
  perform public._audit('redeem_ticket', v_t.id::text, '{}', p_agent_id);

  return jsonb_build_object('ok', true, 'ticket_id', v_t.id, 'client', v_client, 'dish', v_dish,
                            'extras', v_t.extras, 'used_at', v_t.used_at,
                            'counters', public.service_counters(p_service_date, p_service));
end $$;

-- Cron (toutes les 5 min) : valid → expired une fois le service terminé
create function public.expire_tickets() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  update public.tickets set status = 'expired' where status = 'valid' and valid_until <= now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create function public.rate_ticket(p_ticket_id uuid, p_stars int, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t public.tickets;
begin
  select * into v_t from public.tickets where id = p_ticket_id and user_id = auth.uid();
  if not found then return public._fail('TICKET_NOT_FOUND', 'Ticket introuvable.'); end if;
  if v_t.status <> 'used' then return public._fail('NOT_USED', 'Vous pourrez noter ce plat après l''avoir mangé.'); end if;
  if p_stars is null or p_stars not between 1 and 5 then return public._fail('INVALID_STARS', 'Note de 1 à 5.'); end if;
  insert into public.ratings (ticket_id, user_id, dish_id, stars, comment)
  values (v_t.id, v_t.user_id, v_t.dish_id, p_stars, nullif(btrim(left(p_comment, 500)), ''))
  on conflict (ticket_id) do nothing;
  if not found then return public._fail('ALREADY_RATED', 'Vous avez déjà noté ce repas.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ═════════════════════════════ Menus ═════════════════════════════

create function public.validate_menu_item() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_week date;
begin
  select week_start into v_week from public.menus where id = new.menu_id;
  if new.service_date not between v_week and v_week + 6 then
    raise exception 'La date % n''appartient pas à la semaine du %', new.service_date, v_week;
  end if;
  return new;
end $$;
create trigger menu_items_validate before insert or update of menu_id, service_date on public.menu_items
  for each row execute function public.validate_menu_item();

create function public.submit_menu(p_menu_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.menus;
begin
  if not public.has_role('chef') then return public._fail('FORBIDDEN', 'Réservé au chef.'); end if;
  select * into v from public.menus where id = p_menu_id for update;
  if not found then return public._fail('MENU_NOT_FOUND', 'Menu introuvable.'); end if;
  if v.status <> 'draft' then return public._fail('INVALID_STATUS', 'Ce menu est déjà soumis.'); end if;
  if not exists (select 1 from public.menu_items where menu_id = v.id) then
    return public._fail('EMPTY_MENU', 'Le menu est vide.');
  end if;
  update public.menus set status = 'submitted', submitted_at = now() where id = v.id;
  perform public._audit('submit_menu', v.id::text, jsonb_build_object('week_start', v.week_start));
  perform public._notify_roles('{admin}', 'menu_submitted', 'Menu soumis',
    'Le menu de la semaine du ' || to_char(v.week_start, 'DD/MM') || ' est prêt à être publié.',
    jsonb_build_object('menu_id', v.id));
  return jsonb_build_object('ok', true, 'late', now() > public.menu_deadline(v.week_start));
end $$;

create function public.publish_menu(p_menu_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.menus;
begin
  if not public.has_role('chef') then return public._fail('FORBIDDEN', 'Réservé au chef ou à l''admin.'); end if;
  select * into v from public.menus where id = p_menu_id for update;
  if not found then return public._fail('MENU_NOT_FOUND', 'Menu introuvable.'); end if;
  if v.status = 'published' then return public._fail('INVALID_STATUS', 'Ce menu est déjà publié.'); end if;
  if now() > public.menu_deadline(v.week_start) and not public.has_role('admin') then
    return public._fail('DEADLINE_PASSED', 'Date limite dépassée : seul l''admin peut publier ce menu.');
  end if;
  if not exists (select 1 from public.menu_items where menu_id = v.id) then
    return public._fail('EMPTY_MENU', 'Le menu est vide.');
  end if;
  update public.menus set status = 'published', published_at = now(), submitted_at = coalesce(submitted_at, now())
   where id = v.id;
  perform public._audit('publish_menu', v.id::text, jsonb_build_object('week_start', v.week_start));
  perform public._notify_roles('{client}', 'menu_published', 'Le menu de la semaine est disponible 🍽️',
    'Découvrez les plats de la semaine du ' || to_char(v.week_start, 'DD/MM') || ' et réservez vos repas.',
    jsonb_build_object('menu_id', v.id));
  return jsonb_build_object('ok', true);
end $$;

-- Cron horaire : rappel au chef le mardi, alerte admin si la date limite est dépassée. Idempotent.
create function public.check_menu_deadlines(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_local timestamp := p_now at time zone 'Africa/Abidjan';
  v_next date := (date_trunc('week', v_local) + interval '7 days')::date;
  v_status public.menu_status;
  v_deadline timestamptz := public.menu_deadline(v_next);
  v_reminded boolean := false;
  v_alerted boolean := false;
begin
  select status into v_status from public.menus where week_start = v_next;
  if v_status is null or v_status = 'draft' then
    if extract(isodow from v_local) = 2 and p_now < v_deadline and not exists (
         select 1 from public.notifications where type = 'menu_reminder' and data ->> 'week_start' = v_next::text) then
      perform public._notify_roles('{chef}', 'menu_reminder', 'Rappel : menu de la semaine prochaine',
        'À soumettre avant ' || to_char(v_deadline at time zone 'Africa/Abidjan', 'TMDay DD/MM "à" HH24"h"MI') || '.',
        jsonb_build_object('week_start', v_next));
      v_reminded := true;
    end if;
    if p_now > v_deadline and not exists (
         select 1 from public.notifications where type = 'menu_deadline_missed' and data ->> 'week_start' = v_next::text) then
      perform public._notify_roles('{admin}', 'menu_deadline_missed', 'Menu non soumis ⚠️',
        'Le menu de la semaine du ' || to_char(v_next, 'DD/MM') || ' n''a pas été soumis avant la date limite.',
        jsonb_build_object('week_start', v_next));
      v_alerted := true;
    end if;
  end if;
  return jsonb_build_object('week_start', v_next, 'reminded', v_reminded, 'alerted', v_alerted);
end $$;

-- ═════════════════════════════ Stock ═════════════════════════════

create function public.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old numeric; v_new numeric; v_ing public.ingredients;
begin
  select * into v_ing from public.ingredients where id = new.ingredient_id for update;
  v_old := v_ing.stock_qty;
  v_new := v_old + case new.type when 'in' then new.qty when 'adjust' then new.qty else -new.qty end;
  update public.ingredients set stock_qty = v_new where id = new.ingredient_id;
  if v_new < v_ing.alert_threshold and v_old >= v_ing.alert_threshold then
    perform public._notify_roles('{chef}', 'stock_low', 'Stock bas : ' || v_ing.name,
      'Reste ' || trim(to_char(v_new, 'FM999990.###')) || ' ' || v_ing.unit || ' (seuil ' ||
      trim(to_char(v_ing.alert_threshold, 'FM999990.###')) || ').', jsonb_build_object('ingredient_id', v_ing.id));
  end if;
  return new;
end $$;
create trigger stock_movements_apply after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- Inventaire : enregistre l'écart entre le stock compté et le stock théorique
create function public.stock_inventory(p_ingredient_id uuid, p_counted numeric, p_reason text default 'Inventaire')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_delta numeric;
begin
  if not public.has_role('chef') then return public._fail('FORBIDDEN', 'Réservé au chef.'); end if;
  if p_counted is null or p_counted < 0 then return public._fail('INVALID_QTY', 'Quantité invalide.'); end if;
  select p_counted - stock_qty into v_delta from public.ingredients where id = p_ingredient_id for update;
  if not found then return public._fail('NOT_FOUND', 'Ingrédient introuvable.'); end if;
  if v_delta <> 0 then
    insert into public.stock_movements (ingredient_id, type, qty, reason) values (p_ingredient_id, 'adjust', v_delta, p_reason);
  end if;
  return jsonb_build_object('ok', true, 'delta', v_delta);
end $$;

-- ═════════════════════════════ Administration ═════════════════════════════

create function public.set_user_blocked(p_user_id uuid, p_blocked boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role('caissier') then return public._fail('FORBIDDEN', 'Accès refusé.'); end if;
  if p_user_id = auth.uid() then return public._fail('SELF', 'Impossible de bloquer votre propre compte.'); end if;
  if (select role from public.profiles where id = p_user_id) <> 'client' and not public.has_role('admin') then
    return public._fail('FORBIDDEN', 'Seul l''admin peut bloquer un membre de l''équipe.');
  end if;
  update public.profiles set is_blocked = p_blocked where id = p_user_id;
  if not found then return public._fail('USER_NOT_FOUND', 'Utilisateur introuvable.'); end if;
  perform public._audit(case when p_blocked then 'block_user' else 'unblock_user' end, p_user_id::text);
  return jsonb_build_object('ok', true);
end $$;

create function public.admin_set_role(p_user_id uuid, p_role public.user_role) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role('admin') then return public._fail('FORBIDDEN', 'Réservé à l''admin.'); end if;
  if p_user_id = auth.uid() and p_role <> 'admin' then
    return public._fail('SELF', 'Vous ne pouvez pas retirer votre propre rôle admin.');
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then return public._fail('USER_NOT_FOUND', 'Utilisateur introuvable.'); end if;
  perform public._audit('set_role', p_user_id::text, jsonb_build_object('role', p_role));
  return jsonb_build_object('ok', true);
end $$;

-- Avis publics (prénom seulement)
create view public.dish_reviews as
  select r.id, r.dish_id, r.stars, r.comment, r.created_at, split_part(p.full_name, ' ', 1) as author
    from public.ratings r join public.profiles p on p.id = r.user_id;

create view public.dish_stats as
  select d.id as dish_id, round(avg(r.stars)::numeric, 1) as avg_stars, count(r.id)::int as ratings_count
    from public.dishes d left join public.ratings r on r.dish_id = d.id
   group by d.id;
