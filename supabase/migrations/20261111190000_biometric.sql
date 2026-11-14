-- Face ID / empreinte (WebAuthn « passkey » de l'appareil) : verrouillage de l'appli + confirmation des opérations d'argent.
-- Le visage ne quitte jamais le téléphone : on garde seulement la clé publique de l'appareil.
-- Une vérification réussie (Edge Function « webauthn ») ouvre une autorisation de 2 min, À USAGE UNIQUE :
--   - recharge Mobile Money : refusée sans elle si le compte a activé Face ID ;
--   - achats > 5 000 F, cadeaux, transferts : le code PIN peut être remplacé par 'BIOMETRIC' (consomme l'autorisation).
-- Création seulement (aucune suppression) : _check_pin est redéfinie avec la même signature.

create table if not exists public.webauthn_credentials (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  credential_id text not null unique,          -- base64url
  public_key    text not null,                 -- base64url (COSE)
  counter       bigint not null default 0,
  transports    text[] not null default '{}',
  device_name   text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists webauthn_credentials_user on public.webauthn_credentials (user_id);
alter table public.webauthn_credentials enable row level security;
grant select (id, device_name, created_at, last_used_at) on public.webauthn_credentials to authenticated;
create policy webauthn_credentials_own on public.webauthn_credentials for select to authenticated using (user_id = auth.uid());
grant all on public.webauthn_credentials to service_role;

create table if not exists public.webauthn_challenges (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  challenge  text not null,
  kind       text not null check (kind in ('register', 'auth')),
  created_at timestamptz not null default now()
);
alter table public.webauthn_challenges enable row level security;   -- aucune politique : Edge Function seulement
grant all on public.webauthn_challenges to service_role;

alter table public.profiles add column if not exists biometric_enabled boolean not null default false;
alter table public.profiles add column if not exists biometric_ok_until timestamptz;
grant select (biometric_enabled) on public.profiles to authenticated;

-- Autorisation Face ID encore valable ? (la consomme si p_consume)
create or replace function public._biometric_ok(p_user uuid, p_consume boolean default true) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ok boolean;
begin
  select coalesce(biometric_ok_until > now(), false) into v_ok from public.profiles where id = p_user;
  if v_ok and p_consume then update public.profiles set biometric_ok_until = null where id = p_user; end if;
  return coalesce(v_ok, false);
end $$;
revoke all on function public._biometric_ok(uuid, boolean) from public, anon, authenticated;

-- PIN : 'BIOMETRIC' est accepté à la place des 4 chiffres, pour SON propre compte, juste après Face ID
create or replace function public._check_pin(p_user uuid, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v public.profiles;
begin
  if p_pin = 'BIOMETRIC' then
    if p_user = auth.uid() and public._biometric_ok(p_user) then return null; end if;
    return 'BIOMETRIC_REQUIRED';
  end if;
  -- NO KEY UPDATE : n'entre pas en conflit avec le FOR KEY SHARE posé par les clés étrangères
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

-- Recharge Mobile Money : Face ID obligatoire si le compte l'a activé (la base refuse sinon)
create or replace function public._biometric_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.type = 'recharge'
     and (select biometric_enabled from public.profiles where id = new.user_id)
     and not public._biometric_ok(new.user_id) then
    raise exception 'BIOMETRIC_REQUIRED' using hint = 'Confirmez avec Face ID ou votre empreinte.';
  end if;
  return new;
end $$;
drop trigger if exists transactions_biometric on public.transactions;
create trigger transactions_biometric before insert on public.transactions
  for each row when (new.type = 'recharge') execute function public._biometric_guard();

-- Déverrouillage / confirmation par code PIN (secours quand Face ID n'est pas disponible) : ouvre aussi l'autorisation de 2 min
create or replace function public.check_my_pin(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_err text;
begin
  if auth.uid() is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  if p_pin = 'BIOMETRIC' then return public._fail('PIN_INVALID', 'Code PIN incorrect.'); end if;
  v_err := public._check_pin(auth.uid(), p_pin);
  if v_err is not null then return public._pin_fail(v_err); end if;
  -- Le bon PIN vaut confirmation (secours quand Face ID n'est pas disponible sur cet appareil)
  update public.profiles set biometric_ok_until = now() + interval '2 minutes' where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.check_my_pin(text) from public, anon;
grant execute on function public.check_my_pin(text) to authenticated;

-- Téléphone perdu : les clés Face ID des autres appareils sont supprimées aussi
create or replace function public._secure_account(p_user uuid, p_keep_session uuid default null, p_keep_endpoint text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_tickets int; v_sessions int := 0; v_push int; v_keys int;
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
  delete from public.webauthn_credentials where user_id = p_user;
  get diagnostics v_keys = row_count;
  update public.profiles set biometric_enabled = false, biometric_ok_until = null where id = p_user;
  perform public._audit('secure_account', p_user::text,
    jsonb_build_object('tickets', v_tickets, 'sessions', v_sessions, 'push', v_push, 'biometric_keys', v_keys));
  return jsonb_build_object('tickets', v_tickets, 'sessions', v_sessions);
end $$;

-- Message clair quand Face ID est demandé
create or replace function public._pin_fail(p_code text) returns jsonb
language sql volatile set search_path = public, pg_temp as $$
  select case p_code
    when 'PIN_NOT_SET' then public._fail(p_code, 'Vous devez d''abord créer votre code PIN.')
    when 'BIOMETRIC_REQUIRED' then public._fail(p_code, 'Confirmez avec Face ID (ou votre empreinte), ou utilisez votre code PIN.')
    when 'PIN_LOCKED'  then public._fail(p_code, 'Trop d''essais. Code PIN bloqué pendant 15 minutes.',
                              jsonb_build_object('locked_until',
                                (select pin_locked_until from public.profiles where id = auth.uid())))
    else public._fail(p_code, 'Code PIN incorrect.',
           jsonb_build_object('attempts_left', 3 - (select pin_failed_attempts from public.profiles where id = auth.uid())))
  end
$$;
