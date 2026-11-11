-- Suppléments en QUANTITÉ : pour 10 tickets, on peut prendre 6 « Salade de fruits » + 4 « Yaourt » (ou 3 desserts seulement).
-- p_extras = [{ "id": "<extra>", "qty": 6 }, …] ; par type (entrée / dessert), le total ne dépasse pas le nombre de tickets.
-- Chaque ticket reçoit au plus 1 entrée et 1 dessert ; son prix = ticket + ses suppléments. p_extra_ids reste accepté
-- (ancien comportement : le même supplément sur chaque ticket).
drop function if exists public.purchase_tickets(public.service_kind, int, uuid[], text, uuid, boolean);

create function public.purchase_tickets(p_service public.service_kind, p_quantity int default 1,
                                        p_extra_ids uuid[] default '{}', p_pin text default null,
                                        p_beneficiary_id uuid default null, p_use_reward boolean default false,
                                        p_extras jsonb default null)
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
  v_req jsonb := '[]';
  v_starters jsonb := '[]';   -- une entrée par ticket, dans l'ordre
  v_desserts jsonb := '[]';   -- un dessert par ticket, dans l'ordre
  v_tx_extras jsonb;
  v_t_total int;
  v_total int := 0;
  v_reward boolean := false;
  v_err text;
  v_balance int;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_tx public.transactions;
  v_label text := public.service_label(p_service);
  v_gift_from text;
  v_gift_to text;
  v_note text;
  r record;
begin
  if v_uid is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  select * into v_me from public.profiles where id = v_uid;
  if v_me.is_blocked then return public._fail('ACCOUNT_BLOCKED', 'Votre compte est bloqué.'); end if;
  if v_cfg is null or (v_cfg ->> 'price') is null then return public._fail('SERVICE_UNKNOWN', 'Type de ticket inconnu.'); end if;
  if p_quantity is null or p_quantity not between 1 and 10 then
    return public._fail('INVALID_QUANTITY', 'Entre 1 et 10 tickets par achat.');
  end if;
  if v_for <> v_uid then
    select full_name || coalesce(' · ' || short_code, '') into v_gift_to from public.profiles where id = v_for and not is_blocked;
    if v_gift_to is null then return public._fail('RECIPIENT_NOT_FOUND', 'Bénéficiaire introuvable.'); end if;
    v_gift_from := v_me.full_name || coalesce(' · ' || v_me.short_code, '');
  end if;
  v_price := (v_cfg ->> 'price')::int;

  -- Demande de suppléments : nouvelle forme (quantités) ou ancienne (même supplément sur chaque ticket)
  if p_extras is not null and jsonb_typeof(p_extras) = 'array' then
    v_req := p_extras;
  elsif cardinality(coalesce(p_extra_ids, '{}')) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('id', x, 'qty', p_quantity)), '[]') into v_req from unnest(p_extra_ids) x;
  end if;
  -- quantités nulles ignorées
  select coalesce(jsonb_agg(e), '[]') into v_req from jsonb_array_elements(v_req) e where coalesce((e ->> 'qty')::int, 0) > 0;

  if jsonb_array_length(v_req) > 0 then
    if not coalesce((v_cfg ->> 'extras')::boolean, false) then
      return public._fail('EXTRAS_NOT_ALLOWED', 'Pas de supplément pour le ' || lower(v_label) || '.');
    end if;
    if exists (select 1 from jsonb_array_elements(v_req) e
                where (e ->> 'qty') !~ '^[0-9]+$'
                   or not exists (select 1 from public.extras x where x.id::text = e ->> 'id' and x.is_active and x.kind in ('starter', 'dessert')))
       or (select count(*) from jsonb_array_elements(v_req) e) <> (select count(distinct e ->> 'id') from jsonb_array_elements(v_req) e) then
      return public._fail('INVALID_EXTRA', 'Supplément inconnu.');
    end if;
    if exists (select 1 from jsonb_array_elements(v_req) e join public.extras x on x.id::text = e ->> 'id'
                group by x.kind having sum((e ->> 'qty')::int) > p_quantity) then
      return public._fail('INVALID_EXTRA', 'Au plus une entrée et un dessert par ticket (' || p_quantity || ' ticket'
        || case when p_quantity > 1 then 's' else '' end || ').');
    end if;
    -- Liste « déroulée » : un élément par ticket servi avec ce supplément
    for r in select x.id, x.name, x.kind, x.price, (e ->> 'qty')::int as qty
               from jsonb_array_elements(v_req) e join public.extras x on x.id::text = e ->> 'id'
              order by x.sort, x.name loop
      for k in 1..r.qty loop
        if r.kind = 'starter' then
          v_starters := v_starters || jsonb_build_array(jsonb_build_object('id', r.id, 'name', r.name, 'kind', r.kind, 'price', r.price));
        else
          v_desserts := v_desserts || jsonb_build_array(jsonb_build_object('id', r.id, 'name', r.name, 'kind', r.kind, 'price', r.price));
        end if;
      end loop;
    end loop;
  end if;

  -- Fidélité : 10 points = 1 ticket offert (petit-déjeuner par défaut ; sans supplément)
  if p_use_reward then
    if p_service::text <> coalesce(v_loy ->> 'reward_service', 'breakfast') then
      return public._fail('REWARD_UNAVAILABLE', 'Vos points offrent un ticket ' || lower(public.service_label((v_loy ->> 'reward_service')::public.service_kind)) || '.');
    end if;
    if v_me.points < (v_loy ->> 'reward_points')::int then
      return public._fail('REWARD_UNAVAILABLE', 'Il vous faut ' || (v_loy ->> 'reward_points') || ' points.');
    end if;
    v_reward := true;
  end if;

  -- Total = Σ (ticket + ses suppléments) ; le ticket fidélité ne paie que ses suppléments
  for i in 1..p_quantity loop
    v_t_total := case when v_reward and i = 1 then 0 else v_price end
      + coalesce((v_starters -> (i - 1) ->> 'price')::int, 0) + coalesce((v_desserts -> (i - 1) ->> 'price')::int, 0);
    v_total := v_total + v_t_total;
  end loop;

  if v_total > coalesce((public.setting('pin_threshold'))::int, 5000) or v_for <> v_uid then
    v_err := public._check_pin(v_uid, p_pin);
    if v_err is not null then return public._pin_fail(v_err); end if;
  end if;

  select balance into v_balance from public.wallets where user_id = v_uid for update;
  if v_balance < v_total then
    return public._fail('INSUFFICIENT_FUNDS', 'Solde insuffisant.', jsonb_build_object('balance', v_balance, 'total', v_total));
  end if;

  for i in 1..p_quantity loop
    v_tx_extras := '[]'::jsonb;
    if v_starters -> (i - 1) is not null then v_tx_extras := v_tx_extras || jsonb_build_array(v_starters -> (i - 1)); end if;
    if v_desserts -> (i - 1) is not null then v_tx_extras := v_tx_extras || jsonb_build_array(v_desserts -> (i - 1)); end if;
    v_t_total := case when v_reward and i = 1 then 0 else v_price end
      + coalesce((v_starters -> (i - 1) ->> 'price')::int, 0) + coalesce((v_desserts -> (i - 1) ->> 'price')::int, 0);
    insert into public.tickets (user_id, buyer_id, service, extras, total, is_reward, valid_from, valid_until, gift_from)
    values (v_for, v_uid, p_service, v_tx_extras, v_t_total, v_reward and i = 1, now(),
            now() + make_interval(hours => v_hours), v_gift_from)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  if v_total > 0 then
    -- « 10 × ticket Déjeuner + 6 Salade de fruits + 4 Yaourt » (sans nombre quand chaque ticket a le supplément)
    select p_quantity || ' × ticket ' || v_label || coalesce(' + ' || string_agg(case when n = p_quantity then name else n || ' ' || name end, ' + ' order by kind desc, name), '')
      into v_note
      from (select e ->> 'name' as name, e ->> 'kind' as kind, count(*) as n
              from jsonb_array_elements(v_starters || v_desserts) e group by 1, 2) s;
    v_tx := public._wallet_move(v_uid, -v_total, 'purchase', p_ticket => case when p_quantity = 1 then v_ids[1] end,
              p_counterpart => nullif(v_for, v_uid), p_note => v_note);
    if v_gift_to is not null then update public.transactions set counterpart_name = v_gift_to where id = v_tx.id; end if;
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

revoke all on function public.purchase_tickets(public.service_kind, int, uuid[], text, uuid, boolean, jsonb) from public, anon;
grant execute on function public.purchase_tickets(public.service_kind, int, uuid[], text, uuid, boolean, jsonb) to authenticated;
