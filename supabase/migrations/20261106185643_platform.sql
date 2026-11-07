-- Dabali — intégrations plateforme Supabase (cron, realtime, storage).
-- Chaque bloc est ignoré si la fonctionnalité n'existe pas (Postgres local des tests).

-- ───────────── Cron ─────────────
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('dabali-expire-tickets', '*/5 * * * *', 'select public.expire_tickets()');
    perform cron.schedule('dabali-menu-deadlines', '5 * * * *',   'select public.check_menu_deadlines()');
  else
    raise notice 'pg_cron indisponible : crons non planifiés';
  end if;
end $$;

-- ───────────── Realtime ─────────────
-- menu_items  : rupture en direct (§4.3, §12 « < 3 s »)
-- occupancy_snapshots : indicateur d'affluence
-- tickets / wallets / notifications : mises à jour de l'appli client (RLS appliquée par Realtime)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.menu_items, public.occupancy_snapshots, public.tickets, public.wallets, public.notifications;
  else
    raise notice 'publication supabase_realtime absente';
  end if;
end $$;

-- ───────────── Storage : photos des plats ─────────────
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('dishes', 'dishes', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $p$create policy "dishes photos read" on storage.objects for select to anon, authenticated
                using (bucket_id = 'dishes')$p$;
    execute $p$create policy "dishes photos write" on storage.objects for insert to authenticated
                with check (bucket_id = 'dishes' and public.has_role('chef'))$p$;
    execute $p$create policy "dishes photos update" on storage.objects for update to authenticated
                using (bucket_id = 'dishes' and public.has_role('chef'))$p$;
    execute $p$create policy "dishes photos delete" on storage.objects for delete to authenticated
                using (bucket_id = 'dishes' and public.has_role('chef'))$p$;
  else
    raise notice 'schéma storage absent : bucket non créé';
  end if;
end $$;
