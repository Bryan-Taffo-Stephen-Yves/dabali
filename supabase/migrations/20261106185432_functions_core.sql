-- Dabali — fonctions utilitaires et RPC transactionnelles
--
-- Convention : les RPC appelées par l'appli renvoient un jsonb
--   { "ok": true, ... }  ou  { "ok": false, "code": "SOLD_OUT", "message": "..." }
-- Elles ne lèvent PAS d'exception pour les erreurs métier : un PIN faux doit pouvoir
-- incrémenter le compteur d'échecs sans que la transaction soit annulée. Toutes les
-- validations sont faites AVANT la première écriture financière.

-- ═════════════════════════════ Utilitaires ═════════════════════════════

create function public.setting(p_key text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select value from public.settings where key = p_key
$$;

create function public.has_role(variadic p_roles public.user_role[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select not p.is_blocked and (p.role = 'admin' or p.role = any (p_roles))
       from public.profiles p where p.id = auth.uid()),
    false)
$$;

create function public.is_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.has_role('agent', 'caissier', 'chef')
$$;

create function public.today_abidjan() returns date
language sql stable as $$ select (now() at time zone 'Africa/Abidjan')::date $$;

-- Début / fin d'un service, en heure d'Abidjan
create function public.service_window(p_date date, p_service public.service_kind,
                                      out starts_at timestamptz, out ends_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select (p_date + (s ->> 'start')::time) at time zone 'Africa/Abidjan',
         (p_date + (s ->> 'end')::time)   at time zone 'Africa/Abidjan'
    from (select public.setting('services') -> p_service::text as s) x
$$;

-- Date limite de soumission du menu d'une semaine (défaut : mercredi 23h59 de la semaine précédente)
create function public.menu_deadline(p_week_start date) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select ((p_week_start - 7 + ((d ->> 'weekday')::int - 1)) + (d ->> 'time')::time + interval '59 seconds')
           at time zone 'Africa/Abidjan'
    from (select public.setting('menu_deadline') as d) x
$$;

create function public._fail(p_code text, p_message text, p_extra jsonb default '{}') returns jsonb
language sql immutable as $$
  select jsonb_build_object('ok', false, 'code', p_code, 'message', p_message) || p_extra
$$;

create function public._notify(p_user uuid, p_type text, p_title text, p_body text, p_data jsonb default '{}')
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, type, title, body, data) values (p_user, p_type, p_title, p_body, p_data)
$$;

create function public._notify_roles(p_roles public.user_role[], p_type text, p_title text, p_body text,
                                     p_data jsonb default '{}')
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, type, title, body, data)
  select id, p_type, p_title, p_body, p_data from public.profiles where role = any (p_roles) and not is_blocked
$$;

create function public._audit(p_action text, p_target text, p_payload jsonb default '{}', p_actor uuid default auth.uid())
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_log (actor_id, action, target, payload) values (p_actor, p_action, p_target, p_payload)
$$;

create function public.format_fcfa(p_amount int) returns text
language sql immutable as $$
  select replace(to_char(p_amount, 'FM999,999,999'), ',', U&'\00A0') || U&'\00A0' || 'FCFA'
$$;

-- Mouvement de portefeuille. LE WALLET DOIT ÊTRE VERROUILLÉ PAR L'APPELANT (select … for update).
-- Le CHECK (balance >= 0) est le dernier filet de sécurité.
create function public._wallet_move(p_user uuid, p_amount int, p_type public.tx_type,
                                    p_counterpart uuid default null, p_ticket uuid default null,
                                    p_performed_by uuid default null, p_note text default null)
returns public.transactions
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_balance int;
  v_tx public.transactions;
begin
  update public.wallets set balance = balance + p_amount, updated_at = now()
   where user_id = p_user returning balance into v_balance;
  if not found then raise exception 'wallet % introuvable', p_user; end if;

  insert into public.transactions (user_id, type, amount, balance_after, counterpart_id, ticket_id, performed_by, note)
  values (p_user, p_type, p_amount, v_balance, p_counterpart, p_ticket, coalesce(p_performed_by, auth.uid()), p_note)
  returning * into v_tx;

  if p_amount < 0 and v_balance < coalesce((public.setting('low_balance_threshold'))::int, 0)
     and v_balance - p_amount >= coalesce((public.setting('low_balance_threshold'))::int, 0) then
    perform public._notify(p_user, 'low_balance', 'Solde bas',
      'Votre solde est de ' || public.format_fcfa(v_balance) || '. Pensez à recharger.');
  end if;
  return v_tx;
end $$;

-- ═════════════════════════════ Inscription ═════════════════════════════

create function public._gen_short_code() returns text
language plpgsql volatile set search_path = public, pg_temp as $$
declare v_code text; v_digits int := 4;
begin
  for i in 1..60 loop
    if i > 30 then v_digits := 5; end if;
    v_code := 'DB-' || lpad(floor(random() * power(10, v_digits))::int::text, v_digits, '0');
    exit when not exists (select 1 from public.profiles where short_code = v_code);
  end loop;
  return v_code;
end $$;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}');
  v_phone text := nullif(regexp_replace(coalesce(v_meta ->> 'phone', ''), '[^0-9+]', '', 'g'), '');
begin
  insert into public.profiles (id, full_name, phone, short_code)
  values (new.id,
          coalesce(nullif(btrim(v_meta ->> 'full_name'), ''), split_part(new.email, '@', 1)),
          v_phone,
          public._gen_short_code());
  insert into public.wallets (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═════════════════════════════ PIN ═════════════════════════════

-- Renvoie null si le PIN est correct, sinon un code d'erreur. Écrit le compteur d'échecs :
-- l'appelant doit RENVOYER (pas lever) l'erreur pour que ce compteur soit conservé.
create function public._check_pin(p_user uuid, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v public.profiles;
begin
  -- NO KEY UPDATE : n'entre pas en conflit avec le FOR KEY SHARE posé par les clés étrangères
  -- (transactions.counterpart_id → profiles) d'un transfert inverse simultané.
  select * into v from public.profiles where id = p_user for no key update;
  if v.pin_hash is null then return 'PIN_NOT_SET'; end if;
  if v.pin_locked_until is not null and v.pin_locked_until > now() then return 'PIN_LOCKED'; end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' or extensions.crypt(p_pin, v.pin_hash) <> v.pin_hash then
    if v.pin_failed_attempts + 1 >= 3 then
      update public.profiles set pin_failed_attempts = 0, pin_locked_until = now() + interval '15 minutes'
       where id = p_user;
      perform public._audit('pin_locked', p_user::text, '{}', p_user);
      return 'PIN_LOCKED';
    end if;
    update public.profiles set pin_failed_attempts = v.pin_failed_attempts + 1 where id = p_user;
    return 'PIN_INVALID';
  end if;

  if v.pin_failed_attempts > 0 or v.pin_locked_until is not null then
    update public.profiles set pin_failed_attempts = 0, pin_locked_until = null where id = p_user;
  end if;
  return null;
end $$;

create function public._pin_fail(p_code text) returns jsonb
language sql volatile set search_path = public, pg_temp as $$
  select case p_code
    when 'PIN_NOT_SET' then public._fail(p_code, 'Vous devez d''abord créer votre code PIN.')
    when 'PIN_LOCKED'  then public._fail(p_code, 'Trop d''essais. Code PIN bloqué pendant 15 minutes.',
                              jsonb_build_object('locked_until',
                                (select pin_locked_until from public.profiles where id = auth.uid())))
    else public._fail(p_code, 'Code PIN incorrect.',
           jsonb_build_object('attempts_left', 3 - (select pin_failed_attempts from public.profiles where id = auth.uid())))
  end
$$;

create function public.set_pin(p_pin text, p_current_pin text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_uid uuid := auth.uid(); v_err text;
begin
  if v_uid is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return public._fail('PIN_FORMAT', 'Le code PIN doit contenir exactement 4 chiffres.');
  end if;
  if p_pin ~ '^(\d)\1{3}$' or p_pin in ('1234', '4321', '0123', '9876') then
    return public._fail('PIN_TOO_SIMPLE', 'Ce code PIN est trop simple.');
  end if;
  if (select pin_hash from public.profiles where id = v_uid) is not null then
    v_err := public._check_pin(v_uid, p_current_pin);
    if v_err is not null then return public._pin_fail(v_err); end if;
  end if;
  update public.profiles set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)),
                             pin_failed_attempts = 0, pin_locked_until = null
   where id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- ═════════════════════════════ Recharge ═════════════════════════════

create function public.simulate_recharge(p_amount int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_lim jsonb := public.setting('recharge_limits');
  v_tx public.transactions;
begin
  if v_uid is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  if (select is_blocked from public.profiles where id = v_uid) then
    return public._fail('ACCOUNT_BLOCKED', 'Votre compte est bloqué. Adressez-vous à la caisse.');
  end if;
  if p_amount is null or p_amount < (v_lim ->> 'min')::int or p_amount > (v_lim ->> 'max')::int then
    return public._fail('INVALID_AMOUNT', 'Montant entre ' || public.format_fcfa((v_lim ->> 'min')::int)
                        || ' et ' || public.format_fcfa((v_lim ->> 'max')::int) || '.');
  end if;
  perform 1 from public.wallets where user_id = v_uid for update;
  v_tx := public._wallet_move(v_uid, p_amount, 'recharge', p_note => 'Mobile Money (simulation)');
  return jsonb_build_object('ok', true, 'balance', v_tx.balance_after, 'transaction_id', v_tx.id);
end $$;

-- Caisse : crédit contre espèces
create function public.credit_wallet(p_user_id uuid, p_amount int, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_tx public.transactions;
  v_name text;
begin
  if not public.has_role('caissier') then return public._fail('FORBIDDEN', 'Réservé à la caisse.'); end if;
  if p_amount is null or p_amount < 100 or p_amount > 1000000 then
    return public._fail('INVALID_AMOUNT', 'Montant entre 100 FCFA et 1 000 000 FCFA.');
  end if;
  select full_name into v_name from public.profiles where id = p_user_id;
  if not found then return public._fail('USER_NOT_FOUND', 'Client introuvable.'); end if;

  perform 1 from public.wallets where user_id = p_user_id for update;
  v_tx := public._wallet_move(p_user_id, p_amount, 'recharge_cash', p_performed_by => v_uid,
                              p_note => coalesce(nullif(btrim(p_note), ''), 'Espèces (caisse)'));
  perform public._audit('credit_wallet', p_user_id::text, jsonb_build_object('amount', p_amount, 'tx', v_tx.id));
  perform public._notify(p_user_id, 'wallet_credited', 'Compte crédité',
                         public.format_fcfa(p_amount) || ' ajoutés à votre solde à la caisse.');
  return jsonb_build_object('ok', true, 'balance', v_tx.balance_after, 'transaction_id', v_tx.id,
    'receipt', jsonb_build_object('client', v_name, 'amount', p_amount, 'balance_after', v_tx.balance_after,
                                  'cashier', (select full_name from public.profiles where id = v_uid),
                                  'at', v_tx.created_at));
end $$;

-- ═════════════════════════════ Transferts ═════════════════════════════

-- Recherche d'un destinataire par téléphone, identifiant court (DB-4821) ou contenu du QR de profil
create function public.lookup_recipient(p_query text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := upper(btrim(coalesce(p_query, '')));
  v_phone text := regexp_replace(v_q, '[^0-9+]', '', 'g');
  v public.profiles;
begin
  if auth.uid() is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  v_q := regexp_replace(v_q, '^DABALI:', '');   -- QR de profil : « DABALI:DB-4821 »
  select * into v from public.profiles
   where short_code = v_q
      or (length(v_phone) >= 8 and (phone = v_phone or phone = '+225' || v_phone or '+225' || phone = v_phone))
   limit 1;
  if not found or v.is_blocked then return public._fail('NOT_FOUND', 'Aucun utilisateur trouvé.'); end if;
  if v.id = auth.uid() then return public._fail('SELF', 'C''est votre propre compte.'); end if;
  return jsonb_build_object('ok', true, 'id', v.id, 'full_name', v.full_name, 'short_code', v.short_code);
end $$;

create function public.transfer_funds(p_recipient_id uuid, p_amount int, p_pin text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_lim jsonb := public.setting('transfer_limits');
  v_err text;
  v_balance int;
  v_today_sent int;
  v_out public.transactions;
  v_sender text;
begin
  if v_uid is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  select full_name into v_sender from public.profiles where id = v_uid and not is_blocked;
  if not found then return public._fail('ACCOUNT_BLOCKED', 'Votre compte est bloqué.'); end if;
  if p_recipient_id = v_uid then return public._fail('SELF_TRANSFER', 'Impossible de vous envoyer de l''argent.'); end if;
  if not exists (select 1 from public.profiles where id = p_recipient_id and not is_blocked) then
    return public._fail('RECIPIENT_NOT_FOUND', 'Destinataire introuvable.');
  end if;
  if p_amount is null or p_amount < (v_lim ->> 'min')::int then
    return public._fail('AMOUNT_TOO_LOW', 'Montant minimum : ' || public.format_fcfa((v_lim ->> 'min')::int) || '.');
  end if;
  if p_amount > (v_lim ->> 'max')::int then
    return public._fail('AMOUNT_TOO_HIGH', 'Montant maximum par transfert : ' || public.format_fcfa((v_lim ->> 'max')::int) || '.');
  end if;

  v_err := public._check_pin(v_uid, p_pin);
  if v_err is not null then return public._pin_fail(v_err); end if;

  -- Verrouillage des deux portefeuilles dans un ordre fixe (évite les interblocages A→B / B→A)
  perform 1 from public.wallets where user_id in (v_uid, p_recipient_id) order by user_id for update;
  select balance into v_balance from public.wallets where user_id = v_uid;

  select coalesce(-sum(amount), 0) into v_today_sent from public.transactions
   where user_id = v_uid and type = 'transfer_out'
     and created_at >= (public.today_abidjan()::timestamp at time zone 'Africa/Abidjan');
  if v_today_sent + p_amount > (v_lim ->> 'daily_max')::int then
    return public._fail('DAILY_LIMIT', 'Plafond journalier atteint (' || public.format_fcfa((v_lim ->> 'daily_max')::int)
                        || '). Reste aujourd''hui : ' || public.format_fcfa(greatest((v_lim ->> 'daily_max')::int - v_today_sent, 0)) || '.');
  end if;
  if v_balance < p_amount then
    return public._fail('INSUFFICIENT_FUNDS', 'Solde insuffisant.', jsonb_build_object('balance', v_balance));
  end if;

  v_out := public._wallet_move(v_uid, -p_amount, 'transfer_out', p_counterpart => p_recipient_id, p_note => p_note);
  perform public._wallet_move(p_recipient_id, p_amount, 'transfer_in', p_counterpart => v_uid, p_note => p_note);
  perform public._notify(p_recipient_id, 'transfer_received', 'Transfert reçu',
    v_sender || ' vous a envoyé ' || public.format_fcfa(p_amount) || '.', jsonb_build_object('from', v_uid));
  return jsonb_build_object('ok', true, 'balance', v_out.balance_after, 'transaction_id', v_out.id);
end $$;

