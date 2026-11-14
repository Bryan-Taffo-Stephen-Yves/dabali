-- Jean : étape en cours du parcours guidé par boutons (Commander → repas → plat → heure → confirmation).
-- Une ligne par numéro, oubliée après 15 minutes. Serveur seulement.
create table if not exists public.whatsapp_state (
  phone      text primary key,
  step       text not null,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_state enable row level security;
grant all on public.whatsapp_state to service_role;
