-- Menu modifié en cours de semaine (plat ajouté, retiré, épuisé, prix changé) : tous les clients sont prévenus
-- (notification dans l'appli + push), qui ouvre le menu.
-- Anti-spam : les changements sont regroupés ; l'envoi part 2 min après la DERNIÈRE modification du chef,
-- en une seule notification. Un plat ajouté puis retiré dans la foulée ne déclenche rien.
-- Seuls les menus publiés et les jours à venir (ou aujourd'hui) comptent. Création seulement, aucune suppression.

create table if not exists public.menu_changes (
  id           bigint generated always as identity primary key,
  service_date date not null,
  service      public.service_kind not null,
  dish_id      uuid not null,
  dish_name    text not null,
  kind         text not null check (kind in ('added', 'removed', 'sold_out', 'back', 'price')),
  old_price    int,
  new_price    int,
  changed_by   uuid,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index if not exists menu_changes_pending on public.menu_changes (created_at) where sent_at is null;
alter table public.menu_changes enable row level security;   -- aucune politique : interne
grant all on public.menu_changes to service_role;

create or replace function public._log_menu_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.menu_items; v_name text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  -- Seulement un chef (ou admin) connecté, sur un menu publié, pour aujourd'hui ou plus tard
  if auth.uid() is null or r.service_date < public.today_abidjan()
     or not exists (select 1 from public.menus m where m.id = r.menu_id and m.status = 'published') then
    return null;
  end if;
  select name into v_name from public.dishes where id = r.dish_id;
  if tg_op = 'INSERT' then
    insert into public.menu_changes (service_date, service, dish_id, dish_name, kind, new_price, changed_by)
    values (r.service_date, r.service, r.dish_id, v_name, 'added', r.price, auth.uid());
  elsif tg_op = 'DELETE' then
    insert into public.menu_changes (service_date, service, dish_id, dish_name, kind, old_price, changed_by)
    values (r.service_date, r.service, r.dish_id, v_name, 'removed', r.price, auth.uid());
  else
    if new.is_sold_out is distinct from old.is_sold_out then
      insert into public.menu_changes (service_date, service, dish_id, dish_name, kind, changed_by)
      values (r.service_date, r.service, r.dish_id, v_name, case when new.is_sold_out then 'sold_out' else 'back' end, auth.uid());
    end if;
    if new.price is distinct from old.price then
      insert into public.menu_changes (service_date, service, dish_id, dish_name, kind, old_price, new_price, changed_by)
      values (r.service_date, r.service, r.dish_id, v_name, 'price', old.price, new.price, auth.uid());
    end if;
  end if;
  return null;
end $$;

create trigger menu_items_log_change after insert or update of price, is_sold_out or delete on public.menu_items
  for each row execute function public._log_menu_change();

-- « aujourd'hui », « demain », « jeudi 14/11 »
create or replace function public._day_label(p_date date) returns text
language sql stable set search_path = public, pg_temp as $$
  select case p_date - public.today_abidjan()
    when 0 then 'aujourd''hui' when 1 then 'demain'
    else (array['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'])[extract(isodow from p_date)::int]
         || ' ' || to_char(p_date, 'DD/MM')
  end
$$;

-- Envoi groupé (pg_cron, chaque minute). p_quiet : délai de calme après la dernière modification.
create or replace function public.send_menu_changes(p_quiet interval default interval '2 minutes') returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_groups jsonb; v_n int; v_title text; v_body text; v_first jsonb;
begin
  -- Le chef modifie encore : on attend
  if exists (select 1 from public.menu_changes where sent_at is null and created_at > now() - p_quiet) then return 0; end if;
  if not exists (select 1 from public.menu_changes where sent_at is null) then return 0; end if;

  with pending as (
    select * from public.menu_changes where sent_at is null and service_date >= public.today_abidjan()
  ),
  -- État net par plat : premier et dernier événement de chaque sorte
  per_dish as (
    select service_date, service, dish_id, dish_name,
           bool_or(kind = 'added') as added, bool_or(kind = 'removed') as removed,
           (array_agg(kind order by id desc) filter (where kind in ('sold_out', 'back')))[1] as stock,
           (array_agg(old_price order by id) filter (where kind = 'price'))[1] as p_old,
           (array_agg(new_price order by id desc) filter (where kind = 'price'))[1] as p_new,
           (array_agg(kind order by id desc) filter (where kind in ('added', 'removed')))[1] as last_presence
      from pending group by 1, 2, 3, 4
  ),
  lines as (
    select service_date, service,
      case
        when added and removed then null                                   -- ajouté puis retiré (ou l'inverse) : rien
        when added then 'Nouveau : ' || dish_name
        when removed then 'Retiré : ' || dish_name
        when stock = 'sold_out' then 'Épuisé : ' || dish_name
        when p_new is not null and p_new is distinct from p_old then dish_name || ' à ' || public.format_fcfa(p_new)
        when stock = 'back' then 'De retour : ' || dish_name
      end as line,
      case when added and not removed then 1 when removed and not added then 2 when stock = 'sold_out' then 3 else 4 end as ord
    from per_dish
  )
  select jsonb_agg(jsonb_build_object('date', service_date, 'service', service, 'lines', ls) order by service_date, service)
    into v_groups
    from (select service_date, service, jsonb_agg(line order by ord, line) as ls
            from lines where line is not null group by 1, 2) g;

  update public.menu_changes set sent_at = now() where sent_at is null;
  v_n := coalesce(jsonb_array_length(v_groups), 0);
  if v_n = 0 then return 0; end if;

  v_first := v_groups -> 0;
  if v_n = 1 then
    v_title := 'Menu modifié : ' || public.service_label((v_first ->> 'service')::public.service_kind)
               || ' ' || public._day_label((v_first ->> 'date')::date) || ' 🍽️';
    v_body := (select string_agg(x, ' · ') from jsonb_array_elements_text(v_first -> 'lines') x);
  else
    v_title := 'Le menu a changé 🍽️';
    v_body := (select string_agg(public.service_label((g ->> 'service')::public.service_kind) || ' '
                                 || public._day_label((g ->> 'date')::date) || ' : '
                                 || (select string_agg(x, ', ') from jsonb_array_elements_text(g -> 'lines') x), ' · ')
                 from jsonb_array_elements(v_groups) g);
  end if;
  if length(v_body) > 180 then v_body := left(v_body, 177) || '…'; end if;

  perform public._notify_roles('{client}', 'menu_changed', v_title, v_body,
    jsonb_build_object('href', '/app/menu', 'changes', v_groups));
  return v_n;
end $$;
revoke all on function public.send_menu_changes(interval) from public, anon, authenticated;
grant execute on function public.send_menu_changes(interval) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('dabali-menu-changes', '* * * * *', 'select public.send_menu_changes()');
  end if;
end $$;
