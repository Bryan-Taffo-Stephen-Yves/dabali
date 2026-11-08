-- Notifications push (Web Push, téléphone verrouillé / appli fermée).
-- Chaque notification insérée pour un utilisateur abonné déclenche l'Edge Function send-push via pg_net.
-- Clés VAPID et secret d'appel : Supabase Vault (vapid_private_key, vapid_public_key, push_webhook_secret).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

-- Adresse de la fonction d'envoi (renseignée par scripts/install.sh pour chaque projet)
insert into public.settings (key, value) values ('push_function_url', 'null') on conflict (key) do nothing;

create function public._push_config() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'private', (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private_key' order by created_at desc limit 1),
    'public', (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_public_key' order by created_at desc limit 1),
    'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_webhook_secret' order by created_at desc limit 1))
$$;
revoke all on function public._push_config() from public, anon, authenticated;
grant execute on function public._push_config() to service_role;

create function public._push_dispatch() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_url text := public.setting('push_function_url') #>> '{}';
begin
  if v_url is null or to_regproc('net.http_post') is null then return null; end if;
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then return null; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', public._push_config() ->> 'secret'),
    body := jsonb_build_object('notification_id', new.id));
  return null;
exception when others then
  return null; -- une panne d'envoi ne doit jamais bloquer la notification dans l'appli
end $$;
create trigger notifications_push after insert on public.notifications
  for each row execute function public._push_dispatch();
