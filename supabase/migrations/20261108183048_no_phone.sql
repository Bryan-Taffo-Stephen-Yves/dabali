-- Manger sans téléphone (perdu, éteint, batterie vide) et téléphone perdu ou volé.
--
-- 1. Au comptoir, l'agent retrouve le client par son code Dabali (DB-1234) ou son nom,
--    puis le CLIENT tape son code PIN sur le téléphone de l'agent : le ticket du service est validé
--    exactement comme un scan (même règles, même argent reversé, même plat à choisir).
-- 2. Sécurité :
--    - le PIN (secret mémorisé) remplace le QR ; 3 erreurs → PIN bloqué 15 min et client prévenu ;
--    - un agent qui accumule 10 PIN faux en une heure est bloqué sur ce mode (essais en série) ;
--    - chaque validation sans QR prévient le client (notification + push) et reste marquée « sans QR ».
-- 3. Téléphone perdu ou volé : on renouvelle les QR des tickets valides (ceux gardés hors ligne
--    dans l'ancien téléphone ne passent plus), on ferme les autres sessions et on retire ses notifications push.
--    Possible depuis un autre appareil (Profil) ou au comptoir, juste après le PIN.

alter table public.tickets add column redeem_method text not null default 'qr' check (redeem_method in ('qr', 'pin'));
grant select (redeem_method) on public.tickets to authenticated;

-- Renouvelle les QR, ferme les sessions (sauf celle à garder) et retire les abonnements push (sauf celui à garder)
create function public._secure_account(p_user uuid, p_keep_session uuid default null, p_keep_endpoint text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_tickets int; v_sessions int := 0; v_push int;
begin
  update public.tickets set qr_nonce = encode(extensions.gen_random_bytes(16), 'hex')
   where user_id = p_user and status = 'valid';
  get diagnostics v_tickets = row_count;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1 and ($2::uuid is null or id <> $2)' using p_user, p_keep_session;
    get diagnostics v_sessions = row_count;
  end if;
  delete from public.push_subscriptions where user_id = p_user and (p_keep_endpoint is null or endpoint <> p_keep_endpoint);
  get diagnostics v_push = row_count;
  perform public._audit('secure_account', p_user::text,
    jsonb_build_object('tickets', v_tickets, 'sessions', v_sessions, 'push', v_push));
  return jsonb_build_object('tickets', v_tickets, 'sessions', v_sessions);
end $$;
revoke all on function public._secure_account(uuid, uuid, text) from public, anon, authenticated;

-- Depuis un autre appareil : « J'ai perdu mon téléphone »
create function public.secure_my_devices(p_keep_endpoint text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_res jsonb;
begin
  if v_uid is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  v_res := public._secure_account(v_uid, nullif(auth.jwt() ->> 'session_id', '')::uuid, p_keep_endpoint);
  perform public._notify(v_uid, 'account_secured', 'Anciens appareils déconnectés',
    'Vos QR ont été renouvelés : ceux de l''ancien téléphone ne fonctionnent plus.', jsonb_build_object('href', '/app/tickets'));
  return jsonb_build_object('ok', true) || v_res;
end $$;

-- Recherche au comptoir : par code Dabali (DB-1234, 1234) ou par nom (3 lettres minimum)
create function public.counter_lookup(p_query text, p_service public.service_kind) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_code text;
  v_like text;
begin
  if not public.has_role('agent') then return public._fail('FORBIDDEN', 'Compte agent requis.'); end if;
  if length(v_q) < 3 then return jsonb_build_object('ok', true, 'results', '[]'::jsonb); end if;
  if upper(v_q) ~ '^(DB)?[- ]?[0-9]{4,6}$' then v_code := 'DB-' || regexp_replace(v_q, '\D', '', 'g'); end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return jsonb_build_object('ok', true, 'results', coalesce((
    select jsonb_agg(x order by x ->> 'full_name') from (
      select jsonb_build_object(
        'short_code', p.short_code, 'full_name', p.full_name,
        'has_pin', p.pin_hash is not null,
        'locked', coalesce(p.pin_locked_until > now(), false),
        'tickets', (select count(*) from public.tickets t
                     where t.user_id = p.id and t.status = 'valid' and t.service = p_service and t.valid_until > now())) as x
        from public.profiles p
       where not p.is_blocked
         and (case when v_code is not null then p.short_code = v_code else p.full_name ilike v_like end)
       order by p.full_name
       limit 8) s), '[]'::jsonb));
end $$;

-- Validation au comptoir avec le code PIN du client (à la place du QR)
create function public.redeem_with_pin(p_short_code text, p_pin text, p_service_date date, p_service public.service_kind,
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
  -- Essais en série depuis un même scanner : bloqué au-delà de 10 PIN faux en une heure
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

  -- Ticket à utiliser : celui du service qui expire le plus tôt (vérifié avant le PIN pour ne pas brûler d'essai)
  select * into v_t from public.tickets
   where user_id = v_user.id and status = 'valid' and service = p_service and valid_until > now()
   order by valid_until, created_at limit 1
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
  return v_res || jsonb_build_object('method', 'pin', 'short_code', v_user.short_code);
end $$;

revoke all on function public.secure_my_devices(text), public.counter_lookup(text, public.service_kind),
  public.redeem_with_pin(text, text, date, public.service_kind, boolean) from public, anon;
grant execute on function public.secure_my_devices(text), public.counter_lookup(text, public.service_kind),
  public.redeem_with_pin(text, text, date, public.service_kind, boolean) to authenticated;
