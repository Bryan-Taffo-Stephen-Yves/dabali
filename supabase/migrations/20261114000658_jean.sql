-- Jean, l'agent IA de Dabali sur WhatsApp (et plus tard au téléphone).
-- Sécurité :
--   1. Liaison du numéro : le client génère un code à 6 chiffres DANS L'APPLI (connecté) et l'envoie à Jean depuis son
--      WhatsApp. Le numéro n'est lié qu'après ce code (un numéro saisi à l'inscription ne suffit pas).
--   2. Jean ne passe jamais de commande seul : il prépare une « demande de commande » et envoie un lien ; le client la
--      confirme dans l'appli avec son code PIN (jamais de PIN dans WhatsApp).
--   3. Jean lit seulement les données du client lié (solde, menu, ses commandes) via l'Edge Function (service_role).
--   4. Messages limités par minute, journalisés ; « J'ai perdu mon téléphone » délie WhatsApp.
-- Les notifications de suivi de commande partent aussi sur WhatsApp (déclencheur → Edge Function « jean-whatsapp »).

-- Réglages non secrets de Jean (numéro, serveur Green API) ; le jeton Green API reste dans les secrets des Edge Functions
insert into public.settings (key, value) values
  ('jean', '{"whatsapp_phone": null, "green_api_url": null, "green_api_id": null, "function_url": null}')
on conflict (key) do nothing;

-- ═════════════ Liaison WhatsApp ↔ compte ═════════════
create table if not exists public.whatsapp_links (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  phone     text not null unique check (phone ~ '^\+[0-9]{8,15}$'),
  linked_at timestamptz not null default now()
);
alter table public.whatsapp_links enable row level security;
grant select on public.whatsapp_links to authenticated;
create policy whatsapp_links_own on public.whatsapp_links for select to authenticated using (user_id = auth.uid());
grant all on public.whatsapp_links to service_role;

create table if not exists public.whatsapp_link_codes (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  code_hash  text not null,
  expires_at timestamptz not null
);
alter table public.whatsapp_link_codes enable row level security;   -- aucune politique : serveur seulement
grant all on public.whatsapp_link_codes to service_role;

-- Journal des messages (historique de conversation, limite de débit, anti-doublon)
create table if not exists public.whatsapp_messages (
  id         bigint generated always as identity primary key,
  wa_id      text unique,
  phone      text not null,
  user_id    uuid references public.profiles (id) on delete set null,
  direction  text not null check (direction in ('in', 'out')),
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_messages_phone on public.whatsapp_messages (phone, created_at desc);
alter table public.whatsapp_messages enable row level security;
grant all on public.whatsapp_messages to service_role;

-- Code de liaison (dans l'appli, connecté) : 6 chiffres, valable 10 minutes
create or replace function public.whatsapp_link_start() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_code text := lpad((floor(random() * 1000000))::int::text, 6, '0');
begin
  if auth.uid() is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  insert into public.whatsapp_link_codes (user_id, code_hash, expires_at)
  values (auth.uid(), extensions.crypt(v_code, extensions.gen_salt('bf', 6)), now() + interval '10 minutes')
  on conflict (user_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at;
  return jsonb_build_object('ok', true, 'code', v_code, 'expires_at', now() + interval '10 minutes',
    'jean_phone', public.setting('jean') ->> 'whatsapp_phone');
end $$;
revoke all on function public.whatsapp_link_start() from public, anon;
grant execute on function public.whatsapp_link_start() to authenticated;

create or replace function public.whatsapp_unlink() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  delete from public.whatsapp_links where user_id = auth.uid();
  perform public._audit('whatsapp_unlink', auth.uid()::text);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.whatsapp_unlink() from public, anon;
grant execute on function public.whatsapp_unlink() to authenticated;

-- Côté serveur : le code reçu sur WhatsApp lie ce numéro au compte. 5 essais faux par numéro et par heure au plus.
create or replace function public._whatsapp_link_claim(p_phone text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_user uuid; v_name text;
begin
  if (select count(*) from public.audit_log
       where action = 'whatsapp_link_failed' and target = p_phone and created_at > now() - interval '1 hour') >= 5 then
    return public._fail('THROTTLED', 'Trop d''essais. Réessayez dans une heure.');
  end if;
  select c.user_id into v_user from public.whatsapp_link_codes c
   where c.expires_at > now() and extensions.crypt(p_code, c.code_hash) = c.code_hash limit 1;
  if v_user is null then
    perform public._audit('whatsapp_link_failed', p_phone, '{}', null);
    return public._fail('BAD_CODE', 'Code invalide ou expiré.');
  end if;
  delete from public.whatsapp_link_codes where user_id = v_user;
  delete from public.whatsapp_links where phone = p_phone or user_id = v_user;
  insert into public.whatsapp_links (user_id, phone) values (v_user, p_phone);
  select full_name into v_name from public.profiles where id = v_user;
  perform public._audit('whatsapp_linked', p_phone, '{}', v_user);
  perform public._notify(v_user, 'whatsapp_linked', 'WhatsApp lié à ton compte',
    'Jean te répondra désormais sur le ' || p_phone || '. Ce n''était pas toi ? Délie-le dans ton profil.',
    jsonb_build_object('href', '/app/profil'));
  return jsonb_build_object('ok', true, 'user_id', v_user, 'full_name', v_name);
end $$;
revoke all on function public._whatsapp_link_claim(text, text) from public, anon, authenticated;
grant execute on function public._whatsapp_link_claim(text, text) to service_role;

-- ═════════════ Demandes de commande (préparées par Jean, confirmées dans l'appli) ═════════════
create table if not exists public.order_requests (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  pickup_at    timestamptz not null,
  extra_ids    uuid[] not null default '{}',
  source       text not null default 'whatsapp',
  status       text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  ticket_id    uuid references public.tickets (id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '15 minutes'
);
create index if not exists order_requests_user on public.order_requests (user_id, created_at desc);
alter table public.order_requests enable row level security;
grant select (id, token, user_id, menu_item_id, pickup_at, extra_ids, source, status, ticket_id, created_at, expires_at)
  on public.order_requests to authenticated;
create policy order_requests_own on public.order_requests for select to authenticated using (user_id = auth.uid());
grant all on public.order_requests to service_role;

-- Confirmation dans l'appli : seul le titulaire, avec son code PIN (place_order le vérifie)
create or replace function public.confirm_order_request(p_token text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r public.order_requests; v_res jsonb;
begin
  if auth.uid() is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  select * into v_r from public.order_requests where token = p_token for update;
  if not found or v_r.user_id <> auth.uid() then return public._fail('NOT_FOUND', 'Demande introuvable sur ce compte.'); end if;
  if v_r.status = 'done' then return jsonb_build_object('ok', true, 'ticket_id', v_r.ticket_id, 'already', true); end if;
  if v_r.status <> 'pending' or v_r.expires_at < now() then
    return public._fail('EXPIRED', 'Cette demande a expiré. Redemande à Jean.');
  end if;
  v_res := public.place_order(v_r.menu_item_id, v_r.pickup_at, v_r.extra_ids, p_pin);
  if coalesce((v_res ->> 'ok')::boolean, false) then
    update public.order_requests set status = 'done', ticket_id = (v_res ->> 'ticket_id')::uuid where id = v_r.id;
  end if;
  return v_res;
end $$;
revoke all on function public.confirm_order_request(text, text) from public, anon;
grant execute on function public.confirm_order_request(text, text) to authenticated;

create or replace function public.cancel_order_request(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.order_requests set status = 'cancelled'
   where token = p_token and user_id = auth.uid() and status = 'pending';
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.cancel_order_request(text) from public, anon;
grant execute on function public.cancel_order_request(text) to authenticated;

-- ═════════════ Téléphone perdu : WhatsApp délié aussi ═════════════
create or replace function public._secure_account(p_user uuid, p_keep_session uuid default null, p_keep_endpoint text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_tickets int; v_sessions int := 0; v_push int; v_wa int;
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
  delete from public.whatsapp_links where user_id = p_user;
  get diagnostics v_wa = row_count;
  update public.order_requests set status = 'cancelled' where user_id = p_user and status = 'pending';
  perform public._audit('secure_account', p_user::text,
    jsonb_build_object('tickets', v_tickets, 'sessions', v_sessions, 'push', v_push, 'whatsapp', v_wa));
  return jsonb_build_object('tickets', v_tickets, 'sessions', v_sessions);
end $$;

-- ═════════════ Notifications de commande → WhatsApp ═════════════
create or replace function public._jean_secret() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'jean_internal_secret' order by created_at desc limit 1
$$;
revoke all on function public._jean_secret() from public, anon, authenticated;
grant execute on function public._jean_secret() to service_role;

create or replace function public._whatsapp_dispatch() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_url text := public.setting('jean') ->> 'function_url';
begin
  if v_url is null or to_regproc('net.http_post') is null then return null; end if;
  if new.type not in ('order_placed', 'order_preparing', 'order_ready', 'order_pickup_reminder', 'order_missed', 'menu_changed') then return null; end if;
  if not exists (select 1 from public.whatsapp_links where user_id = new.user_id) then return null; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jean-secret', public._jean_secret()),
    body := jsonb_build_object('notification_id', new.id));
  return null;
exception when others then
  return null; -- une panne WhatsApp ne bloque jamais la notification dans l'appli
end $$;
create trigger notifications_whatsapp after insert on public.notifications
  for each row execute function public._whatsapp_dispatch();

-- ═════════════ Rappel 35 min avant la fin du service (commande pas encore récupérée) ═════════════
alter table public.tickets add column if not exists pickup_reminded_at timestamptz;

create or replace function public.remind_order_pickups() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  with due as (
    update public.tickets t set pickup_reminded_at = now()
     where t.status = 'valid' and t.pickup_at is not null and t.pickup_reminded_at is null
       and t.valid_until > now() and t.valid_until <= now() + interval '35 minutes'
       and t.pickup_at <= now()
    returning t.id, t.user_id, t.order_no, t.valid_until, t.menu_item_id
  )
  insert into public.notifications (user_id, type, title, body, data)
  select due.user_id, 'order_pickup_reminder', 'Ta commande n° ' || due.order_no || ' t''attend 🍽️',
         d.name || ' est à récupérer avant ' || to_char(due.valid_until at time zone 'Africa/Abidjan', 'HH24"h"MI')
           || '. Après, elle sera perdue.',
         jsonb_build_object('ticket_id', due.id, 'href', '/app/tickets/' || due.id)
    from due join public.menu_items mi on mi.id = due.menu_item_id join public.dishes d on d.id = mi.dish_id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.remind_order_pickups() from public, anon, authenticated;
grant execute on function public.remind_order_pickups() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('dabali-order-pickup-reminders', '* * * * *', 'select public.remind_order_pickups()');
  end if;
end $$;

-- Secret interne base → Edge Function (aléatoire, créé une seule fois dans le coffre Supabase)
do $$
begin
  if to_regproc('vault.create_secret') is not null
     and not exists (select 1 from vault.decrypted_secrets where name = 'jean_internal_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'jean_internal_secret', 'Appel interne base -> jean-whatsapp');
  end if;
end $$;
