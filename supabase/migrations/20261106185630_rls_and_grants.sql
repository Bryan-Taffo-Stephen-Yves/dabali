-- Dabali — RLS et droits
-- Principe : on retire tous les droits par défaut de Supabase, puis on rend explicitement
-- les droits de table / de colonne nécessaires. La RLS filtre ensuite les lignes.

-- ───────────── RLS activée partout ─────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ───────────── Fonctions utilisées dans les politiques ─────────────
grant execute on function public.has_role(public.user_role[]), public.is_staff(), public.setting(text),
                          public.today_abidjan(), public.service_window(date, public.service_kind),
                          public.menu_deadline(date), public.format_fcfa(int)
  to anon, authenticated;

-- ───────────── RPC exposées à l'appli ─────────────
grant execute on function
  public.set_pin(text, text),
  public.simulate_recharge(int),
  public.credit_wallet(uuid, int, text),
  public.lookup_recipient(text),
  public.transfer_funds(uuid, int, text, text),
  public.purchase_ticket(uuid, uuid[], text, uuid, boolean),
  public.cancel_ticket(uuid),
  public.rate_ticket(uuid, int, text),
  public.service_counters(date, public.service_kind),
  public.submit_menu(uuid),
  public.publish_menu(uuid),
  public.stock_inventory(uuid, numeric, text),
  public.set_user_blocked(uuid, boolean),
  public.admin_set_role(uuid, public.user_role)
to authenticated;
-- redeem_ticket, expire_tickets, check_menu_deadlines : service_role uniquement (Edge Function / cron).

-- ───────────── profiles ─────────────
grant select (id, full_name, phone, short_code, role, points, is_blocked, notify_free_seats, created_at,
              pin_locked_until)
  on public.profiles to authenticated;
grant update (full_name, phone, notify_free_seats) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ───────────── wallets / transactions ─────────────
grant select on public.wallets, public.transactions to authenticated;
create policy wallets_select on public.wallets for select to authenticated
  using (user_id = auth.uid() or public.has_role('caissier'));
create policy transactions_select on public.transactions for select to authenticated
  using (user_id = auth.uid() or public.has_role('caissier'));

-- ───────────── catalogue (lecture publique, écriture chef) ─────────────
grant select on public.categories, public.dishes, public.extras to anon, authenticated;
grant insert, update, delete on public.categories, public.dishes, public.extras to authenticated;
grant usage on sequence public.categories_id_seq to authenticated;

create policy categories_read  on public.categories for select to anon, authenticated using (true);
create policy categories_write on public.categories for all to authenticated
  using (public.has_role('chef')) with check (public.has_role('chef'));
create policy dishes_read  on public.dishes for select to anon, authenticated using (true);
create policy dishes_write on public.dishes for all to authenticated
  using (public.has_role('chef')) with check (public.has_role('chef'));
create policy extras_read  on public.extras for select to anon, authenticated using (true);
create policy extras_write on public.extras for all to authenticated
  using (public.has_role('chef')) with check (public.has_role('chef'));

-- ───────────── stock (chef) ─────────────
grant select, insert, update, delete on public.ingredients, public.recipe_lines to authenticated;
grant select on public.stock_movements to authenticated;
grant insert (ingredient_id, type, qty, reason, menu_item_id) on public.stock_movements to authenticated;

create policy ingredients_chef on public.ingredients for all to authenticated
  using (public.has_role('chef')) with check (public.has_role('chef'));
create policy recipe_lines_chef on public.recipe_lines for all to authenticated
  using (public.has_role('chef')) with check (public.has_role('chef'));
create policy stock_movements_read on public.stock_movements for select to authenticated
  using (public.has_role('chef'));
create policy stock_movements_insert on public.stock_movements for insert to authenticated
  with check (public.has_role('chef') and type <> 'out' and created_by = auth.uid());

-- ───────────── menus (publiés visibles de tous ; statut via RPC uniquement) ─────────────
grant select on public.menus, public.menu_items to anon, authenticated;
grant insert (week_start) on public.menus to authenticated;
grant delete on public.menus to authenticated;
grant insert (menu_id, service_date, service, dish_id, price, planned_qty) on public.menu_items to authenticated;
grant update (price, planned_qty, prepared_qty, is_sold_out) on public.menu_items to authenticated;
grant delete on public.menu_items to authenticated;

create policy menus_read on public.menus for select to anon, authenticated
  using (status = 'published' or public.has_role('chef'));
create policy menus_insert on public.menus for insert to authenticated
  with check (public.has_role('chef'));
create policy menus_delete on public.menus for delete to authenticated
  using (public.has_role('chef') and status = 'draft');

create policy menu_items_read on public.menu_items for select to anon, authenticated
  using (exists (select 1 from public.menus m where m.id = menu_id and m.status = 'published')
         or public.has_role('chef'));
create policy menu_items_insert on public.menu_items for insert to authenticated
  with check (public.has_role('chef'));
create policy menu_items_update on public.menu_items for update to authenticated
  using (public.has_role('chef')) with check (public.has_role('chef'));
create policy menu_items_delete on public.menu_items for delete to authenticated
  using (public.has_role('chef') and sold_qty = 0);

-- ───────────── tickets (lecture seule ; qr_nonce jamais exposé) ─────────────
grant select (id, user_id, buyer_id, menu_item_id, dish_id, extras, total, status, service_date, service,
              valid_from, valid_until, used_at, scanned_by, cancelled_at, created_at)
  on public.tickets to authenticated;
create policy tickets_select on public.tickets for select to authenticated
  using (user_id = auth.uid() or buyer_id = auth.uid() or public.is_staff());

-- ───────────── avis ─────────────
grant select on public.ratings, public.dish_reviews, public.dish_stats to anon, authenticated;
create policy ratings_read on public.ratings for select to anon, authenticated using (true);

-- ───────────── affluence ─────────────
grant select on public.rooms, public.occupancy_snapshots to anon, authenticated;
grant insert, update, delete on public.rooms to authenticated;
create policy rooms_read  on public.rooms for select to anon, authenticated using (true);
create policy rooms_admin on public.rooms for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy occupancy_read on public.occupancy_snapshots for select to anon, authenticated using (true);
-- insertion : module vision avec la clé service_role (contourne la RLS)

-- ───────────── notifications / push ─────────────
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, delete on public.push_subscriptions to authenticated;
grant insert (endpoint, p256dh, auth) on public.push_subscriptions to authenticated;
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────────── paramètres / journal ─────────────
grant select on public.settings to anon, authenticated;
grant update (value) on public.settings to authenticated;
create policy settings_read  on public.settings for select to anon, authenticated using (true);
create policy settings_admin on public.settings for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

grant select on public.audit_log to authenticated;
create policy audit_admin on public.audit_log for select to authenticated using (public.has_role('admin'));
