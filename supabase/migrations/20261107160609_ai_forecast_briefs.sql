-- Assistant IA des prévisions : briefs générés par Claude, mis en cache par jour et par état des prévisions.
create table public.ai_forecast_briefs (
  service_date date primary key,
  input_hash text not null,
  brief jsonb not null,
  model text not null,
  created_at timestamptz not null default now()
);
alter table public.ai_forecast_briefs enable row level security;
create policy "briefs lisibles par la cuisine" on public.ai_forecast_briefs for select to authenticated using (public.has_role('chef'));
grant select on public.ai_forecast_briefs to authenticated;

-- Clé Anthropic stockée dans Supabase Vault ; lisible uniquement par service_role (Edge Function).
create or replace function public._anthropic_key() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'anthropic_api_key' order by created_at desc limit 1
$$;
revoke all on function public._anthropic_key() from public, anon, authenticated;
grant execute on function public._anthropic_key() to service_role;
