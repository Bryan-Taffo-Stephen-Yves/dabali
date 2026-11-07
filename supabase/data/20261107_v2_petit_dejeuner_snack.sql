-- Données v2 pour une base déjà remplie avec l'ancien seed (exécuté une fois sur le projet le 07/11/2026).
-- Ajoute petit-déjeuner et snack (plats, recettes, menus, historique, tickets en circulation) et les entrées.
-- Idempotent : ne fait rien si la catégorie « Petit-déjeuner » existe déjà.
do $$
declare
  v_cat_bf int; v_cat_snack int;
  v_agent uuid := (select id from profiles where role = 'agent' order by created_at limit 1);
  v_caisse uuid := (select id from profiles where role = 'caissier' order by created_at limit 1);
  v_demo uuid := (select id from profiles where short_code = 'DB-2026');
  v_clients uuid[] := (select array_agg(id order by created_at) from profiles where role = 'client' and short_code <> 'DB-2026');
  v_prices jsonb := public.setting('services');
  m record; it record; v_win record;
  v_svc public.service_kind;
  v_n int; v_t timestamptz; v_user uuid; v_total int; v_bal int; v_ticket uuid; v_tx public.transactions;
  v_dishes uuid[];
begin
  if exists (select 1 from categories where name = 'Petit-déjeuner') then raise notice 'déjà fait'; return; end if;
  perform setseed(0.77);

  insert into categories (name, sort) values ('Petit-déjeuner', 0) returning id into v_cat_bf;
  insert into categories (name, sort) values ('Snack', 4) returning id into v_cat_snack;
  delete from categories where name in ('Desserts', 'Boissons') and not exists (select 1 from dishes d where d.category_id = categories.id);

  insert into dishes (name, category_id, description, composition, kcal, weight_g, allergens, base_price) values
    ('Pain beurre & café au lait', v_cat_bf, 'Pain frais beurré et grand café au lait sucré.', 'Pain, beurre, café, lait, sucre', 420, 300, '{gluten,lait}', 500),
    ('Omelette pain', v_cat_bf, 'Omelette aux oignons et tomates dans un pain croustillant.', 'Œufs, oignons, tomate, pain', 480, 280, '{œuf,gluten}', 500),
    ('Bouillie de mil', v_cat_bf, 'Bouillie de mil au lait, parfumée au citron.', 'Mil, lait, sucre, citron', 350, 350, '{lait}', 500),
    ('Crêpes sucrées', v_cat_snack, 'Trois crêpes maison au sucre ou au chocolat.', 'Farine, œufs, lait, sucre, chocolat', 450, 200, '{gluten,œuf,lait}', 700),
    ('Brownie', v_cat_snack, 'Brownie fondant au chocolat.', 'Chocolat, farine, œufs, beurre, sucre', 420, 120, '{gluten,œuf,lait}', 700),
    ('Pain perdu', v_cat_snack, 'Pain perdu doré à la cannelle.', 'Pain, œufs, lait, sucre, cannelle', 400, 180, '{gluten,œuf,lait}', 700),
    ('Croque-monsieur', v_cat_snack, 'Croque-monsieur jambon fromage, bien gratiné.', 'Pain de mie, jambon, fromage, beurre', 480, 200, '{gluten,lait}', 700);

  insert into ingredients (name, unit, stock_qty, alert_threshold, unit_cost) values
    ('Pain', 'pièce', 120, 40, 100), ('Œufs', 'pièce', 180, 60, 100), ('Lait', 'L', 25, 10, 900),
    ('Farine', 'kg', 15, 5, 700), ('Sucre', 'kg', 12, 4, 800), ('Chocolat', 'kg', 4, 2, 4000), ('Mil', 'kg', 10, 4, 600)
  on conflict (name) do nothing;
  insert into recipe_lines (dish_id, ingredient_id, qty_per_portion)
  select d.id, i.id, r.qty from (values
      ('Pain beurre & café au lait', 'Pain', 1), ('Pain beurre & café au lait', 'Lait', 0.2),
      ('Omelette pain', 'Œufs', 2), ('Omelette pain', 'Pain', 1), ('Bouillie de mil', 'Mil', 0.08), ('Bouillie de mil', 'Lait', 0.15),
      ('Crêpes sucrées', 'Farine', 0.08), ('Crêpes sucrées', 'Œufs', 1), ('Crêpes sucrées', 'Lait', 0.15),
      ('Brownie', 'Chocolat', 0.04), ('Brownie', 'Farine', 0.03), ('Brownie', 'Œufs', 1),
      ('Pain perdu', 'Pain', 1), ('Pain perdu', 'Œufs', 1), ('Pain perdu', 'Lait', 0.1), ('Croque-monsieur', 'Pain', 1)) r(dish, ing, qty)
  join dishes d on d.name = r.dish join ingredients i on i.name = r.ing;

  insert into extras (name, price, kind, sort) values ('Salade de crudités', 500, 'starter', 0), ('Avocat vinaigrette', 500, 'starter', 0);
  update extras set is_active = false where kind = 'drink';

  -- Menus : petit-déjeuner (lun→sam) et snack (lun→ven) sur toutes les semaines existantes
  for m in select id, week_start from menus loop
    for k in 0..5 loop
      insert into menu_items (menu_id, service_date, service, dish_id, price, planned_qty)
      select m.id, m.week_start + k, 'breakfast', id, base_price, 22 from dishes where category_id = v_cat_bf;
      continue when k = 5;
      insert into menu_items (menu_id, service_date, service, dish_id, price, planned_qty)
      select m.id, m.week_start + k, 'snack', id, base_price, 20
        from dishes where category_id = v_cat_snack order by md5(name || (m.week_start + k)::text) limit 3;
    end loop;
  end loop;

  -- Historique des services passés (petit-déjeuner, snack) : tickets achetés puis servis
  for it in select mi.*, d.name dish_name from menu_items mi join menus mm on mm.id = mi.menu_id join dishes d on d.id = mi.dish_id
             where mm.status = 'published' and mi.service in ('breakfast', 'snack') order by mi.service_date loop
    select * into v_win from service_window(it.service_date, it.service);
    continue when v_win.ends_at >= now();
    v_n := round(it.planned_qty * (0.45 + 0.4 * random()) * case it.dish_name when 'Pain beurre & café au lait' then 1.2
             when 'Crêpes sucrées' then 1.15 when 'Bouillie de mil' then 0.6 else 0.9 end)::int;
    v_n := least(v_n, it.planned_qty);
    for i in 1..v_n loop
      v_user := v_clients[1 + floor(random() * array_length(v_clients, 1))::int];
      v_t := v_win.starts_at - (interval '30 minutes' + random() * interval '30 hours');
      v_total := (v_prices -> it.service::text ->> 'price')::int;
      select balance into v_bal from wallets where user_id = v_user for update;
      if v_bal < v_total then
        v_tx := _wallet_move(v_user, 5000, 'recharge', p_note => 'Mobile Money (simulation)');
        update transactions set created_at = v_t - interval '3 minutes' where id = v_tx.id;
      end if;
      insert into tickets (user_id, buyer_id, service, menu_item_id, dish_id, total, status, service_date,
                           valid_from, valid_until, used_at, scanned_by, created_at)
      values (v_user, v_user, it.service, it.id, it.dish_id, v_total, 'used', it.service_date, v_t, v_t + interval '48 hours',
              v_win.starts_at + random() * (v_win.ends_at - v_win.starts_at - interval '10 minutes'), v_agent, v_t)
      returning id into v_ticket;
      v_tx := _wallet_move(v_user, -v_total, 'purchase', p_ticket => v_ticket, p_note => '1 × ticket ' || service_label(it.service));
      update transactions set created_at = v_t where id = v_tx.id;
    end loop;
    update menu_items set sold_qty = v_n, served_qty = v_n, prepared_qty = v_n + floor(random() * 4)::int where id = it.id;
  end loop;

  -- Tickets en circulation (achetés ces dernières 30 h)
  foreach v_svc in array array['breakfast', 'snack']::service_kind[] loop
    for i in 1..(case v_svc when 'breakfast' then 25 else 20 end) loop
      v_user := v_clients[1 + floor(random() * array_length(v_clients, 1))::int];
      v_t := now() - (interval '10 minutes' + random() * interval '30 hours');
      v_total := (v_prices -> v_svc::text ->> 'price')::int;
      select balance into v_bal from wallets where user_id = v_user for update;
      if v_bal < v_total then v_tx := _wallet_move(v_user, 5000, 'recharge', p_note => 'Mobile Money (simulation)'); end if;
      insert into tickets (user_id, buyer_id, service, total, valid_from, valid_until, created_at)
      values (v_user, v_user, v_svc, v_total, v_t, v_t + interval '48 hours', v_t) returning id into v_ticket;
      perform _wallet_move(v_user, -v_total, 'purchase', p_ticket => v_ticket, p_note => '1 × ticket ' || service_label(v_svc));
    end loop;
  end loop;

  -- Démo : la cliente a aussi un ticket petit-déjeuner en poche
  perform 1 from wallets where user_id = v_demo for update;
  insert into tickets (user_id, buyer_id, service, total, valid_from, valid_until)
  values (v_demo, v_demo, 'breakfast', 500, now(), now() + interval '48 hours') returning id into v_ticket;
  perform _wallet_move(v_demo, -500, 'purchase', p_ticket => v_ticket, p_note => '1 × ticket Petit-déjeuner');
end $$;
