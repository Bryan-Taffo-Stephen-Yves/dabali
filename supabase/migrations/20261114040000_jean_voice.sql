-- Jean au téléphone (Retell) : identification de l'appelant et lien de confirmation.
-- - Appel depuis un numéro WhatsApp déjà lié : client reconnu directement.
-- - Sinon : le client donne son code (DB-xxxx), reçoit un code à 4 chiffres dans l'appli / sur WhatsApp et le répète.
-- - La commande est préparée par Jean et confirmée par le client dans l'appli (Face ID ou PIN) : jamais de PIN à voix haute.
create table if not exists public.voice_calls (
  call_id      text primary key,
  user_id      uuid references public.profiles (id) on delete cascade,
  pending_user uuid references public.profiles (id) on delete cascade,
  code_hash    text,
  code_expires timestamptz,
  attempts     int not null default 0,
  codes_sent   int not null default 0,
  created_at   timestamptz not null default now()
);
alter table public.voice_calls enable row level security;   -- serveur seulement
grant all on public.voice_calls to service_role;

-- Les codes d'appel et les liens de confirmation partent aussi sur WhatsApp
create or replace function public._whatsapp_dispatch() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_url text := public.setting('jean') ->> 'function_url';
begin
  if v_url is null or to_regproc('net.http_post') is null then return null; end if;
  if new.type not in ('order_placed', 'order_preparing', 'order_ready', 'order_pickup_reminder', 'order_missed', 'menu_changed',
                      'voice_code', 'order_link') then return null; end if;
  if not exists (select 1 from public.whatsapp_links where user_id = new.user_id) then return null; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jean-secret', public._jean_secret()),
    body := jsonb_build_object('notification_id', new.id));
  return null;
exception when others then
  return null;
end $$;
