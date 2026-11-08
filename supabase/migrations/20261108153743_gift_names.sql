-- Tickets offerts : nom de la personne qui offre sur le ticket, et du bénéficiaire dans l'historique de l'acheteur.
alter table public.tickets add column gift_from text;
grant select (gift_from) on public.tickets to authenticated;

update public.tickets t set gift_from = p.full_name || coalesce(' · ' || p.short_code, '')
  from public.profiles p where p.id = t.buyer_id and t.buyer_id <> t.user_id and t.gift_from is null;
update public.transactions x set counterpart_name = p.full_name || coalesce(' · ' || p.short_code, '')
  from public.profiles p where p.id = x.counterpart_id and x.type = 'purchase' and x.counterpart_name is null;

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
  v_gift_from text;
  v_gift_to text;
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
    insert into public.tickets (user_id, buyer_id, service, extras, total, is_reward, valid_from, valid_until, gift_from)
    values (v_for, v_uid, p_service, v_extras, case when v_reward and i = 1 then 0 else v_unit end,
            v_reward and i = 1, now(), now() + make_interval(hours => v_hours), v_gift_from)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  if v_total > 0 then
    v_tx := public._wallet_move(v_uid, -v_total, 'purchase', p_ticket => case when p_quantity = 1 then v_ids[1] end,
              p_counterpart => nullif(v_for, v_uid),
              p_note => p_quantity || ' × ticket ' || v_label ||
                        coalesce(' + ' || (select string_agg(e ->> 'name', ' + ') from jsonb_array_elements(v_extras) e), ''));
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
