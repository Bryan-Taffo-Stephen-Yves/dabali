-- Fiches de courses automatiques.
-- Une seule fiche « ouverte » se remplit toute seule (stock sous le seuil, besoins des menus des 2 prochains jours),
-- la cuisine la complète, le chef l'attribue à un employé qui fait toutes les courses en une fois.
-- Les besoins apparus après le départ vont sur la fiche suivante ; seul un ajout « urgent » du chef rejoint la fiche en cours.
-- À la fin des courses, le stock est crédité et ce qui manquait repart sur la fiche suivante.

create type public.shopping_status as enum ('open', 'assigned', 'shopping', 'done', 'cancelled');

create table public.shopping_lists (
  id          uuid primary key default gen_random_uuid(),
  num         int generated always as identity,
  status      public.shopping_status not null default 'open',
  assigned_to uuid references public.profiles (id),
  assigned_by uuid references public.profiles (id),
  note        text check (length(note) <= 500),
  spent_total int check (spent_total >= 0),
  created_at  timestamptz not null default now(),
  assigned_at timestamptz,
  started_at  timestamptz,
  done_at     timestamptz
);
create unique index shopping_one_open on public.shopping_lists ((true)) where status = 'open';
create index on public.shopping_lists (assigned_to, status);

create table public.shopping_items (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references public.shopping_lists (id) on delete cascade,
  ingredient_id uuid references public.ingredients (id) on delete set null,
  label         text not null check (length(label) between 1 and 120),
  qty           numeric(12, 3) not null check (qty > 0),
  unit          text not null default 'pièce',
  est_cost      int not null default 0 check (est_cost >= 0),
  reason        text,
  source        text not null default 'auto' check (source in ('auto', 'manual')),
  urgent        boolean not null default false,
  status        text not null default 'todo' check (status in ('todo', 'bought', 'missing')),
  bought_qty    numeric(12, 3) check (bought_qty >= 0),
  paid          int check (paid >= 0),
  added_by      uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index shopping_items_ingredient on public.shopping_items (list_id, ingredient_id) where ingredient_id is not null;
create index on public.shopping_items (list_id);

alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;
create policy shopping_lists_staff on public.shopping_lists for select to authenticated using (public.is_staff());
create policy shopping_items_staff on public.shopping_items for select to authenticated using (public.is_staff());
grant select on public.shopping_lists, public.shopping_items to authenticated;
grant all on public.shopping_lists, public.shopping_items to service_role;

create function public.fcfa(p_amount int) returns text language sql immutable as $$
  select replace(to_char(coalesce(p_amount, 0), 'FM999G999G990'), ',', ' ') || ' FCFA'
$$;

-- Nombre lisible : 9.8, 10, 0.25 (le motif '.###' précédent arrondissait à l'unité)
create function public._num(p numeric) returns text language sql immutable as $$
  select rtrim(rtrim(to_char(p, 'FM999999990.999'), '0'), '.')
$$;

-- Fiche ouverte (créée au besoin, sans course possible grâce à l'index unique partiel)
create function public._shopping_open() returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  select id into v from shopping_lists where status = 'open';
  if v is null then
    insert into shopping_lists (status) values ('open') on conflict do nothing returning id into v;
    if v is null then select id into v from shopping_lists where status = 'open'; end if;
  end if;
  return v;
end $$;

-- Besoin calculé par ingrédient : menus des 2 prochains jours (portions prévues non encore servies) + seuil − stock − déjà en cours d'achat
create function public._shopping_needs(p_ingredient uuid default null)
returns table (ingredient_id uuid, name text, unit text, stock numeric, threshold numeric, need numeric, in_transit numeric, to_buy numeric, est_cost int)
language sql stable security definer set search_path = public, pg_temp as $$
  with upcoming as (
    select rl.ingredient_id, sum(rl.qty_per_portion * greatest(coalesce(mi.planned_qty, 30) - mi.served_qty, 0)) need
      from menu_items mi join menus m on m.id = mi.menu_id join recipe_lines rl on rl.dish_id = mi.dish_id
     where m.status in ('published', 'submitted') and not mi.is_sold_out
       and mi.service_date between public.today_abidjan() and public.today_abidjan() + 2
       and (select w.ends_at from public.service_window(mi.service_date, mi.service) w) > now()
       and (p_ingredient is null or rl.ingredient_id = p_ingredient)
     group by rl.ingredient_id
  ), transit as (
    select si.ingredient_id, sum(case when si.status = 'bought' then coalesce(si.bought_qty, si.qty) else si.qty end) qty
      from shopping_items si join shopping_lists sl on sl.id = si.list_id
     where sl.status in ('assigned', 'shopping') and si.status <> 'missing' and si.ingredient_id is not null
     group by si.ingredient_id
  ), calc as (
    select i.id, i.name, i.unit, i.stock_qty, i.alert_threshold, i.unit_cost,
           coalesce(u.need, 0) need, coalesce(t.qty, 0) in_transit,
           coalesce(u.need, 0) + i.alert_threshold - i.stock_qty - coalesce(t.qty, 0) raw
      from ingredients i left join upcoming u on u.ingredient_id = i.id left join transit t on t.ingredient_id = i.id
     where p_ingredient is null or i.id = p_ingredient
  ), rounded as (
    select *, case when raw <= 0 then 0
                   -- déjà en cours d'achat : on ignore les petits écarts (moins d'un quart du seuil)
                   when in_transit > 0 and raw < alert_threshold / 4 then 0
                   when in_transit > 0 then raw
                   -- sinon au moins le seuil d'alerte, pour ne pas repartir acheter 200 g demain
                   else greatest(raw, alert_threshold) end m
      from calc
  ), rounded2 as (
    select *, case when m <= 0 then 0
                   when unit in ('pièce', 'pièces', 'botte', 'sachet', 'paquet') then ceil(m)
                   else ceil(m * 2) / 2 end q
      from rounded
  )
  select id, name, unit, stock_qty, alert_threshold, round(need, 2), in_transit, q, ceil(q * unit_cost)::int from rounded2
$$;

-- Met à jour les lignes automatiques de la fiche ouverte (les lignes saisies à la main ne sont jamais touchées)
create function public._shopping_refresh(p_ingredient uuid default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_list uuid; n int := 0; r record;
begin
  for r in select * from public._shopping_needs(p_ingredient) loop
    if r.to_buy > 0 then
      v_list := coalesce(v_list, public._shopping_open());
      insert into shopping_items (list_id, ingredient_id, label, qty, unit, est_cost, reason, source)
      values (v_list, r.ingredient_id, r.name, r.to_buy, r.unit, r.est_cost,
              case when r.stock < r.threshold then 'Stock ' || public._num(r.stock) || ' ' || r.unit || ' sous le seuil (' || public._num(r.threshold) || ')'
                   else 'Stock ' || public._num(r.stock) || ' ' || r.unit end
              || case when r.need > 0 then ' · menus des 2 prochains jours : ' || public._num(r.need) || ' ' || r.unit else '' end
              || case when r.in_transit > 0 then ' · déjà en cours d''achat : ' || public._num(r.in_transit) else '' end,
              'auto')
      on conflict (list_id, ingredient_id) where ingredient_id is not null do update
        set qty = excluded.qty, est_cost = excluded.est_cost, reason = excluded.reason, updated_at = now()
        where shopping_items.source = 'auto' and shopping_items.qty is distinct from excluded.qty;
      n := n + 1;
    else
      delete from shopping_items si using shopping_lists sl
       where sl.id = si.list_id and sl.status = 'open' and si.ingredient_id = r.ingredient_id and si.source = 'auto';
    end if;
  end loop;
  return n;
end $$;

-- Déclencheur : chaque mouvement qui fait passer (ou laisse) un ingrédient sous son seuil met la fiche à jour
create function public._ingredients_shopping() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._shopping_refresh(new.id);
  return null;
end $$;
create trigger ingredients_shopping after update of stock_qty on public.ingredients
  for each row when (new.stock_qty < new.alert_threshold and new.stock_qty < old.stock_qty)
  execute function public._ingredients_shopping();

create function public._shopping_list_json(p_list uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', l.id, 'num', l.num, 'status', l.status, 'items', count(i.id),
           'est_total', coalesce(sum(i.est_cost), 0))
    from shopping_lists l left join shopping_items i on i.list_id = l.id where l.id = p_list group by l.id
$$;

-- ── RPC ──
create function public.shopping_refresh() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role('chef') then return public._fail('FORBIDDEN', 'Réservé à la cuisine.'); end if;
  perform public._shopping_refresh();
  return jsonb_build_object('ok', true) || coalesce(public._shopping_list_json((select id from shopping_lists where status = 'open')), '{}');
end $$;

create function public.shopping_staff() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role('chef') then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'full_name', full_name, 'role', role) order by role, full_name), '[]')
            from profiles where role in ('agent', 'caissier', 'chef', 'admin') and not is_blocked);
end $$;

-- Ajout manuel. Sans p_list_id : fiche ouverte. Avec la fiche en cours d'un employé : ajout urgent, il est prévenu.
create function public.shopping_add(p_label text, p_qty numeric, p_unit text default 'pièce', p_ingredient_id uuid default null,
                                    p_list_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_list shopping_lists; v_ing ingredients; v_label text := nullif(trim(p_label), ''); v_id uuid;
begin
  if not public.has_role('chef') then return public._fail('FORBIDDEN', 'Réservé à la cuisine.'); end if;
  if p_qty is null or p_qty <= 0 then return public._fail('INVALID_QTY', 'Quantité invalide.'); end if;
  if p_ingredient_id is not null then
    select * into v_ing from ingredients where id = p_ingredient_id;
    if not found then return public._fail('NOT_FOUND', 'Ingrédient introuvable.'); end if;
    v_label := coalesce(v_label, v_ing.name);
  end if;
  if v_label is null then return public._fail('INVALID_LABEL', 'Indiquez quoi acheter.'); end if;

  if p_list_id is null then
    select * into v_list from shopping_lists where id = public._shopping_open() for update;
  else
    select * into v_list from shopping_lists where id = p_list_id for update;
    if not found or v_list.status not in ('open', 'assigned', 'shopping') then
      return public._fail('LIST_CLOSED', 'Cette fiche est terminée.');
    end if;
  end if;

  insert into shopping_items (list_id, ingredient_id, label, qty, unit, est_cost, source, urgent, added_by, reason)
  values (v_list.id, p_ingredient_id, v_label, p_qty, coalesce(v_ing.unit, nullif(trim(p_unit), ''), 'pièce'),
          ceil(p_qty * coalesce(v_ing.unit_cost, 0))::int, 'manual', v_list.status <> 'open', auth.uid(), 'Ajouté par la cuisine')
  on conflict (list_id, ingredient_id) where ingredient_id is not null do update
    set qty = excluded.qty, est_cost = excluded.est_cost, source = 'manual', urgent = excluded.urgent,
        status = 'todo', added_by = excluded.added_by, reason = excluded.reason, updated_at = now()
  returning id into v_id;

  if v_list.status <> 'open' and v_list.assigned_to is not null then
    perform public._notify(v_list.assigned_to, 'shopping_urgent', 'Ajout urgent à ta liste',
      v_label || ' : ' || public._num(p_qty) || ' ' || coalesce(v_ing.unit, p_unit, ''), jsonb_build_object('list_id', v_list.id));
  end if;
  return jsonb_build_object('ok', true, 'item_id', v_id, 'list_id', v_list.id, 'urgent', v_list.status <> 'open');
end $$;

-- Correction d'une quantité par la cuisine (0 = retirer). La ligne devient « manuelle » et n'est plus recalculée.
create function public.shopping_set_qty(p_item_id uuid, p_qty numeric) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item shopping_items; v_status shopping_status; v_cost int;
begin
  if not public.has_role('chef') then return public._fail('FORBIDDEN', 'Réservé à la cuisine.'); end if;
  select si.* into v_item from shopping_items si where si.id = p_item_id for update;
  if not found then return public._fail('NOT_FOUND', 'Ligne introuvable.'); end if;
  select status into v_status from shopping_lists where id = v_item.list_id;
  if v_status not in ('open', 'assigned', 'shopping') then return public._fail('LIST_CLOSED', 'Cette fiche est terminée.'); end if;
  if p_qty is null or p_qty <= 0 then
    delete from shopping_items where id = p_item_id;
    return jsonb_build_object('ok', true, 'deleted', true);
  end if;
  select ceil(p_qty * unit_cost)::int into v_cost from ingredients where id = v_item.ingredient_id;
  update shopping_items set qty = p_qty, est_cost = coalesce(v_cost, est_cost), source = 'manual', updated_at = now() where id = p_item_id;
  return jsonb_build_object('ok', true);
end $$;

create function public.shopping_assign(p_list_id uuid, p_user_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_list shopping_lists; v_n int; v_total int; v_name text;
begin
  if not public.has_role('chef') then return public._fail('FORBIDDEN', 'Réservé à la cuisine.'); end if;
  select * into v_list from shopping_lists where id = p_list_id for update;
  if not found or v_list.status <> 'open' then return public._fail('NOT_OPEN', 'Cette fiche a déjà été attribuée.'); end if;
  select full_name into v_name from profiles where id = p_user_id and role in ('agent', 'caissier', 'chef', 'admin') and not is_blocked;
  if v_name is null then return public._fail('INVALID_USER', 'Choisissez un membre de l''équipe.'); end if;
  select count(*), coalesce(sum(est_cost), 0) into v_n, v_total from shopping_items where list_id = p_list_id;
  if v_n = 0 then return public._fail('EMPTY', 'La fiche est vide.'); end if;

  update shopping_lists set status = 'assigned', assigned_to = p_user_id, assigned_by = auth.uid(), assigned_at = now(),
         note = nullif(trim(p_note), '') where id = p_list_id;
  perform public._notify(p_user_id, 'shopping_assigned', 'Courses à faire · fiche C-' || lpad(v_list.num::text, 4, '0'),
    v_n || ' article' || case when v_n > 1 then 's' else '' end || ' · budget estimé ' || public.fcfa(v_total),
    jsonb_build_object('list_id', p_list_id));
  perform public._audit('shopping_assign', p_list_id::text, jsonb_build_object('to', p_user_id, 'items', v_n, 'est_total', v_total));
  return jsonb_build_object('ok', true, 'items', v_n, 'est_total', v_total, 'assignee', v_name);
end $$;

create function public._shopping_can_shop(v_list shopping_lists) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select v_list.assigned_to = auth.uid() or public.has_role('chef')
$$;

create function public.shopping_start(p_list_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_list shopping_lists;
begin
  select * into v_list from shopping_lists where id = p_list_id for update;
  if not found or not public._shopping_can_shop(v_list) then return public._fail('FORBIDDEN', 'Cette fiche ne vous est pas attribuée.'); end if;
  if v_list.status <> 'assigned' then return public._fail('BAD_STATUS', 'Courses déjà commencées ou terminées.'); end if;
  update shopping_lists set status = 'shopping', started_at = now() where id = p_list_id;
  return jsonb_build_object('ok', true);
end $$;

create function public.shopping_check(p_item_id uuid, p_status text, p_bought_qty numeric default null, p_paid int default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item shopping_items; v_list shopping_lists;
begin
  select * into v_item from shopping_items where id = p_item_id for update;
  if not found then return public._fail('NOT_FOUND', 'Ligne introuvable.'); end if;
  select * into v_list from shopping_lists where id = v_item.list_id;
  if not public._shopping_can_shop(v_list) then return public._fail('FORBIDDEN', 'Cette fiche ne vous est pas attribuée.'); end if;
  if v_list.status not in ('assigned', 'shopping') then return public._fail('BAD_STATUS', 'Fiche non active.'); end if;
  if p_status not in ('todo', 'bought', 'missing') then return public._fail('INVALID_STATUS', 'Statut invalide.'); end if;
  if p_bought_qty is not null and p_bought_qty < 0 or p_paid is not null and p_paid < 0 then
    return public._fail('INVALID_QTY', 'Valeur invalide.');
  end if;
  if v_list.status = 'assigned' then update shopping_lists set status = 'shopping', started_at = now() where id = v_list.id; end if;
  update shopping_items set status = p_status,
         bought_qty = case p_status when 'bought' then coalesce(p_bought_qty, bought_qty, qty) else null end,
         paid = case p_status when 'bought' then coalesce(p_paid, paid) else null end, updated_at = now()
   where id = p_item_id;
  return jsonb_build_object('ok', true);
end $$;

-- Fin des courses : crédit du stock, total dépensé, ce qui manque repart sur la fiche suivante
create function public.shopping_complete(p_list_id uuid, p_spent int default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_list shopping_lists; r record; v_bought int := 0; v_missing int := 0; v_spent int; v_code text;
begin
  select * into v_list from shopping_lists where id = p_list_id for update;
  if not found or not public._shopping_can_shop(v_list) then return public._fail('FORBIDDEN', 'Cette fiche ne vous est pas attribuée.'); end if;
  if v_list.status not in ('assigned', 'shopping') then return public._fail('BAD_STATUS', 'Fiche déjà terminée.'); end if;
  if p_spent is not null and p_spent < 0 then return public._fail('INVALID_AMOUNT', 'Montant invalide.'); end if;
  if exists (select 1 from shopping_items where list_id = p_list_id and status = 'todo') then
    return public._fail('ITEMS_LEFT', 'Cochez chaque article : acheté ou introuvable.');
  end if;
  v_code := 'C-' || lpad(v_list.num::text, 4, '0');

  update shopping_lists set status = 'done', done_at = now() where id = p_list_id;
  for r in select * from shopping_items where list_id = p_list_id loop
    if r.status = 'bought' then
      v_bought := v_bought + 1;
      if r.ingredient_id is not null and coalesce(r.bought_qty, 0) > 0 then
        insert into stock_movements (ingredient_id, type, qty, reason) values (r.ingredient_id, 'in', r.bought_qty, 'Courses ' || v_code);
      end if;
    else
      v_missing := v_missing + 1;
      if r.ingredient_id is null then  -- article libre introuvable : on le remet sur la fiche suivante
        insert into shopping_items (list_id, label, qty, unit, est_cost, source, reason, added_by)
        values (public._shopping_open(), r.label, r.qty, r.unit, r.est_cost, 'manual', 'Introuvable lors des courses ' || v_code, r.added_by);
      end if;
    end if;
  end loop;
  v_spent := coalesce(p_spent, (select sum(paid) from shopping_items where list_id = p_list_id and status = 'bought'));
  update shopping_lists set spent_total = v_spent where id = p_list_id;
  perform public._shopping_refresh();  -- ingrédients introuvables : recalculés sur la fiche suivante

  perform public._notify_roles('{chef}', 'shopping_done', 'Courses ' || v_code || ' terminées',
    v_bought || ' acheté' || case when v_bought > 1 then 's' else '' end
    || case when v_missing > 0 then ', ' || v_missing || ' introuvable' || case when v_missing > 1 then 's' else '' end else '' end
    || case when v_spent is not null then ' · ' || public.fcfa(v_spent) else '' end, jsonb_build_object('list_id', p_list_id));
  perform public._audit('shopping_complete', p_list_id::text, jsonb_build_object('bought', v_bought, 'missing', v_missing, 'spent', v_spent));
  return jsonb_build_object('ok', true, 'bought', v_bought, 'missing', v_missing, 'spent', v_spent);
end $$;

-- Annulation d'une fiche attribuée : ses articles reviennent sur la fiche ouverte
create function public.shopping_cancel(p_list_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_list shopping_lists; v_open uuid;
begin
  if not public.has_role('chef') then return public._fail('FORBIDDEN', 'Réservé à la cuisine.'); end if;
  select * into v_list from shopping_lists where id = p_list_id for update;
  if not found or v_list.status not in ('assigned', 'shopping') then return public._fail('BAD_STATUS', 'Fiche non annulable.'); end if;
  update shopping_lists set status = 'cancelled', done_at = now() where id = p_list_id;
  v_open := public._shopping_open();
  insert into shopping_items (list_id, ingredient_id, label, qty, unit, est_cost, reason, source, added_by)
  select v_open, ingredient_id, label, qty, unit, est_cost, reason, source, added_by from shopping_items
   where list_id = p_list_id and status <> 'bought' and source = 'manual'
  on conflict (list_id, ingredient_id) where ingredient_id is not null do nothing;
  perform public._shopping_refresh();
  if v_list.assigned_to is not null then
    perform public._notify(v_list.assigned_to, 'shopping_cancelled', 'Courses annulées', 'La fiche C-' || lpad(v_list.num::text, 4, '0') || ' a été annulée.', '{}');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Droits
revoke all on function public._shopping_open(), public._shopping_needs(uuid), public._shopping_refresh(uuid),
  public._shopping_list_json(uuid), public._shopping_can_shop(public.shopping_lists) from public, anon, authenticated;
revoke all on function public.shopping_refresh(), public.shopping_staff(), public.shopping_add(text, numeric, text, uuid, uuid),
  public.shopping_set_qty(uuid, numeric), public.shopping_assign(uuid, uuid, text), public.shopping_start(uuid),
  public.shopping_check(uuid, text, numeric, int), public.shopping_complete(uuid, int), public.shopping_cancel(uuid) from public, anon;
grant execute on function public.shopping_refresh(), public.shopping_staff(), public.shopping_add(text, numeric, text, uuid, uuid),
  public.shopping_set_qty(uuid, numeric), public.shopping_assign(uuid, uuid, text), public.shopping_start(uuid),
  public.shopping_check(uuid, text, numeric, int), public.shopping_complete(uuid, int), public.shopping_cancel(uuid) to authenticated;

-- Recalcul périodique (besoins des menus qui approchent) + temps réel pour l'écran de l'acheteur
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('dabali-shopping-refresh', '*/15 * * * *', 'select public._shopping_refresh()');
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.shopping_lists, public.shopping_items;
  end if;
end $$;

-- Correctif : alertes de stock avec décimales (« Reste 9.8 kg » au lieu de « 10 kg »)
create or replace function public.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old numeric; v_new numeric; v_ing public.ingredients;
begin
  select * into v_ing from public.ingredients where id = new.ingredient_id for update;
  v_old := v_ing.stock_qty;
  v_new := v_old + case new.type when 'in' then new.qty when 'adjust' then new.qty else -new.qty end;
  update public.ingredients set stock_qty = v_new where id = new.ingredient_id;
  if v_new < v_ing.alert_threshold and v_old >= v_ing.alert_threshold then
    perform public._notify_roles('{chef}', 'stock_low', 'Stock bas : ' || v_ing.name,
      'Reste ' || public._num(v_new) || ' ' || v_ing.unit || ' (seuil ' ||
      public._num(v_ing.alert_threshold) || ').', jsonb_build_object('ingredient_id', v_ing.id));
  end if;
  return new;
end $$;

create or replace function public.admin_overview(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d date := coalesce(p_date, public.today_abidjan());
  d0 timestamptz := d::timestamp at time zone 'Africa/Abidjan';
  d1 timestamptz := (d + 1)::timestamp at time zone 'Africa/Abidjan';
  r jsonb;
begin
  if not public.has_role('caissier', 'chef') then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'date', d,
    'revenue', coalesce((select -sum(amount) from transactions where type in ('purchase', 'refund') and created_at >= d0 and created_at < d1), 0),
    'recharges', coalesce((select sum(amount) from transactions where type in ('recharge', 'recharge_cash') and created_at >= d0 and created_at < d1), 0),
    'recharges_cash', coalesce((select sum(amount) from transactions where type = 'recharge_cash' and created_at >= d0 and created_at < d1), 0),
    'sold', (select count(*) from tickets where created_at >= d0 and created_at < d1 and status <> 'cancelled'),
    'served', (select count(*) from tickets where used_at >= d0 and used_at < d1),
    'expired', (select count(*) from tickets where status = 'expired' and valid_until >= d0 and valid_until < d1),
    'outstanding', (select count(*) from tickets where status = 'valid' and valid_until > now()),
    'avg_basket', coalesce((select round(avg(total)) from tickets where created_at >= d0 and created_at < d1 and status <> 'cancelled' and total > 0), 0),
    'sold_out', (select count(*) from menu_items mi join menus m on m.id = mi.menu_id
                  where m.status = 'published' and mi.service_date = d and (mi.is_sold_out or mi.is_full)),
    'occupancy', public.occupancy_now(),
    'by_hour', (select coalesce(jsonb_agg(jsonb_build_object('h', h, 'sales', coalesce(s.n, 0), 'scans', coalesce(sc.n, 0)) order by h), '[]')
                  from generate_series(6, 21) h
                  left join (select extract(hour from created_at at time zone 'Africa/Abidjan')::int hh, count(*) n
                               from tickets where created_at >= d0 and created_at < d1 group by 1) s on s.hh = h
                  left join (select extract(hour from used_at at time zone 'Africa/Abidjan')::int hh, count(*) n
                               from tickets where used_at >= d0 and used_at < d1 group by 1) sc on sc.hh = h),
    'top_dishes', (select coalesce(jsonb_agg(x order by x.sold desc), '[]') from (
                    select d2.name, d2.photo_url, count(*)::int sold
                      from tickets t join dishes d2 on d2.id = t.dish_id
                     where t.service_date between d - 6 and d and t.status = 'used'
                     group by d2.id order by 3 desc limit 5) x),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('service', s.svc, 'label', public.service_label(s.svc),
                     'served', (select count(*) from tickets t where t.service_date = d and t.service = s.svc and t.status = 'used'),
                     'outstanding', (select count(*) from tickets t where t.service = s.svc and t.status = 'valid' and t.valid_until > now()),
                     'planned', (select sum(mi.planned_qty)::int from menu_items mi join menus m on m.id = mi.menu_id
                                  where m.status = 'published' and mi.service_date = d and mi.service = s.svc))
                   order by s.o), '[]')
                   from unnest(enum_range(null::public.service_kind)) with ordinality s(svc, o)
                  where public._service_on_menu(d, s.svc)),
    'alerts', (
      select coalesce(jsonb_agg(a), '[]') from (
        select jsonb_build_object('kind', 'stock', 'level', 'warn', 'text', 'Stock bas : ' || name || ' (' || public._num(stock_qty) || ' ' || unit || ')') a
          from ingredients where stock_qty < alert_threshold
        union all
        select jsonb_build_object('kind', 'sold_out', 'level', 'err', 'text', 'Rupture : ' || d2.name || ' (' || lower(public.service_label(mi.service)) || ')')
          from menu_items mi join dishes d2 on d2.id = mi.dish_id join menus m on m.id = mi.menu_id
         where m.status = 'published' and mi.service_date = d and (mi.is_sold_out or mi.is_full)
        union all
        select jsonb_build_object('kind', 'menu', 'level', case when now() > public.menu_deadline(w) then 'err' else 'info' end,
                                  'text', 'Menu de la semaine du ' || to_char(w, 'DD/MM') || ' : ' ||
                                          coalesce((select case status when 'draft' then 'brouillon' when 'submitted' then 'soumis, à publier' end
                                                      from menus where week_start = w and status <> 'published'), 'non créé'))
          from (select (date_trunc('week', d) + interval '7 days')::date w) x
         where not exists (select 1 from menus where week_start = x.w and status = 'published')
      ) al)
  ) into r;
  return r;
end $$;
