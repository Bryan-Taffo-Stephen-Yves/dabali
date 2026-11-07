-- Simule le minimum de Supabase sur un Postgres nu, pour exécuter les migrations et les tests en local.
-- NE PAS exécuter sur un projet Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;
grant usage on schema auth, extensions to anon, authenticated, service_role;

create table auth.users (
  instance_id                 uuid,
  id                          uuid primary key default gen_random_uuid(),
  aud                         text,
  role                        text,
  email                       text unique,
  encrypted_password          text,
  email_confirmed_at          timestamptz,
  raw_app_meta_data           jsonb default '{}',
  raw_user_meta_data          jsonb default '{}',
  confirmation_token          text,
  recovery_token              text,
  email_change_token_new      text,
  email_change                text,
  created_at                  timestamptz default now(),
  updated_at                  timestamptz default now()
);
create table auth.identities (
  id              uuid primary key default gen_random_uuid(),
  provider_id     text not null,
  user_id         uuid references auth.users (id) on delete cascade,
  identity_data   jsonb,
  provider        text not null,
  last_sign_in_at timestamptz,
  created_at      timestamptz,
  updated_at      timestamptz,
  unique (provider_id, provider)
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
