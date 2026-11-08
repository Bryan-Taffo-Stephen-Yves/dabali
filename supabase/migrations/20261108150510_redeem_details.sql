-- Écran de l'agent après un scan : nombre de tickets de l'achat, tickets restants du client,
-- ticket offert (par qui), en plus du supplément (entrée / dessert) déjà renvoyé.
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
  -- Pour l'agent : combien de tickets dans cet achat, combien il en reste au client, offert par qui
  select count(*) into v_batch from public.tickets
   where buyer_id = v_t.buyer_id and service = v_t.service and created_at = v_t.created_at;
  select count(*) into v_remaining from public.tickets
   where user_id = v_t.user_id and service = v_t.service and status = 'valid' and valid_until > now();
  if v_t.buyer_id <> v_t.user_id then select full_name into v_buyer from public.profiles where id = v_t.buyer_id; end if;

  return jsonb_build_object('ok', true, 'ticket_id', v_t.id, 'client', v_client,
    'ticket', public.service_label(v_t.service), 'service', v_t.service, 'extras', v_t.extras, 'used_at', v_t.used_at,
    'batch_size', v_batch, 'remaining', v_remaining, 'gift_from', v_buyer, 'is_reward', v_t.is_reward,
    'dishes', public._service_dishes(p_service_date, p_service),
    'counters', public.service_counters(p_service_date, p_service));
end $$;
