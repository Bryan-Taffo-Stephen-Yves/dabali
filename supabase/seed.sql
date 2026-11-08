-- Dabali — données de démo (§10)
-- Rejouable sur une base vide (ne fait rien si des plats existent déjà).
-- Tous les mouvements d'argent passent par _wallet_move : l'invariant solde = somme des transactions tient.
--
-- Comptes (mot de passe : Dabali2026!) — voir README :
--   admin@dabali.ci · chef@dabali.ci · caisse@dabali.ci · agent@dabali.ci
--   client@dabali.ci (PIN 2580) + client01…client29@dabali.ci

create function pg_temp.seed_user(p_email text, p_name text, p_phone text, p_role public.user_role)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
                          email_change_token_new, email_change, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v, 'authenticated', 'authenticated', p_email,
          extensions.crypt('Dabali2026!', extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_name, 'phone', p_phone),
          '', '', '', '', now() - interval '40 days', now());
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v::text, v, jsonb_build_object('sub', v::text, 'email', p_email, 'email_verified', true),
          'email', now(), now(), now());
  update public.profiles set role = p_role, created_at = now() - interval '40 days' where id = v;
  return v;
end $$;

create temp table seed_sales (
  menu_item_id uuid, user_id uuid, created_at timestamptz, status public.ticket_status, extra_ids uuid[],
  service public.service_kind, service_date date, used_at timestamptz
);

do $$
declare
  v_today   date := public.today_abidjan();
  v_week    date := date_trunc('week', public.today_abidjan())::date;
  v_admin uuid; v_chef uuid; v_caisse uuid; v_agent uuid; v_demo uuid;
  v_clients uuid[] := '{}';
  v_first text[] := array['Aya','Koffi','Adjoua','Yao','Amenan','Kouassi','Affoué','Konan','Akissi','Ibrahim',
                          'Fatou','Moussa','Mariam','Seydou','Awa','Brice','Christelle','Didier','Esther','Franck',
                          'Grâce','Hervé','Inès','Jean-Marc','Kadi','Lamine','Nadia','Olivier','Prisca','Rachelle'];
  v_last  text[] := array['Konan','Kouadio','N''Guessan','Koné','Traoré','Ouattara','Bamba','Diabaté','Yao','Kouamé',
                          'Coulibaly','Touré','Gnagne','Aka','Brou','Assi','Tanoh','Ahoua','Zadi','Gbagbo'];
  v_cat_jour int; v_cat_grill int; v_cat_veg int; v_cat_bf int; v_cat_snack int;
  v_mains uuid[]; v_bf uuid[]; v_sn uuid[];
  v_prices jsonb := public.setting('services');
  v_att int; v_weights numeric[]; v_items uuid[]; v_left int[]; v_pick int; v_acc numeric; v_r numeric;
  v_bf_items uuid[]; v_sn_items uuid[];
  wk record;
  v_menu uuid;
  v_status public.menu_status;
  v_day date;
  v_svc public.service_kind;
  v_lunch uuid[]; v_dinner uuid[];
  v_dish uuid;
  v_item record;
  v_n int; v_planned int;
  v_win record;
  s record;
  v_total int; v_bal int; v_extras jsonb;
  v_ticket uuid; v_tx public.transactions;
  v_room uuid;
  v_t timestamptz;
  v_rate numeric;
  i int; k int;
begin
  if exists (select 1 from public.dishes) then
    raise notice 'Seed ignoré : des plats existent déjà.';
    return;
  end if;
  perform setseed(0.2026);

  -- Le hackathon a lieu un samedi : on sert aussi le samedi
  update public.settings set value = '[1,2,3,4,5,6]' where key = 'service_days';

  -- ───────────── Comptes ─────────────
  v_admin  := pg_temp.seed_user('admin@dabali.ci',  'Bryan Taffo',        '+2250100000001', 'admin');
  v_chef   := pg_temp.seed_user('chef@dabali.ci',   'Koffi N''Guessan',   '+2250100000002', 'chef');
  v_caisse := pg_temp.seed_user('caisse@dabali.ci', 'Awa Diabaté',        '+2250100000003', 'caissier');
  v_agent  := pg_temp.seed_user('agent@dabali.ci',  'Yao Kouamé',         '+2250100000004', 'agent');
  v_demo   := pg_temp.seed_user('client@dabali.ci', 'Aya Konan',          '+2250707070707', 'client');
  update public.profiles set pin_hash = extensions.crypt('2580', extensions.gen_salt('bf', 8)), short_code = 'DB-2026'
   where id = v_demo;
  v_clients := array[v_demo];
  for i in 1..29 loop
    v_clients := v_clients || pg_temp.seed_user(
      'client' || lpad(i::text, 2, '0') || '@dabali.ci',
      v_first[i + 1] || ' ' || v_last[1 + (i * 7) % array_length(v_last, 1)],
      '+22507' || lpad((10000000 + i * 314159 % 89999999)::text, 8, '0'),
      'client');
  end loop;

  -- ───────────── Catalogue ─────────────
  insert into public.categories (name, sort) values ('Plat du jour', 1) returning id into v_cat_jour;
  insert into public.categories (name, sort) values ('Grillades', 2) returning id into v_cat_grill;
  insert into public.categories (name, sort) values ('Végétarien', 3) returning id into v_cat_veg;
  insert into public.categories (name, sort) values ('Petit-déjeuner', 0) returning id into v_cat_bf;
  insert into public.categories (name, sort) values ('Snack', 4) returning id into v_cat_snack;

  insert into public.dishes (name, category_id, description, composition, kcal, weight_g, allergens, base_price) values
    ('Attiéké poisson braisé', v_cat_grill, 'Le grand classique d''Abidjan : poisson braisé au feu de bois, attiéké frais.',
       'Attiéké, poisson braisé, sauce tomate, oignons, piment', 720, 550, '{poisson}', 2500),
    ('Garba', v_cat_jour, 'Attiéké et thon frit, comme au maquis.',
       'Attiéké, thon frit, oignons, tomate, piment', 850, 500, '{poisson}', 1500),
    ('Riz sauce graine', v_cat_jour, 'Sauce graine mijotée au poisson fumé et à la viande de bœuf.',
       'Riz, sauce graine de palme, bœuf, poisson fumé, aubergine', 780, 520, '{poisson}', 2000),
    ('Riz sauce arachide poulet', v_cat_jour, 'Poulet fermier dans une sauce arachide onctueuse.',
       'Riz, poulet, pâte d''arachide, tomate, oignons', 820, 540, '{arachide}', 2500),
    ('Alloco poulet braisé', v_cat_grill, 'Bananes plantains frites et cuisse de poulet braisée.',
       'Banane plantain frite, poulet braisé, oignons, sauce pimentée', 900, 500, '{}', 2500),
    ('Placali sauce kplala', v_cat_jour, 'Pâte de manioc fermentée et sauce kplala aux feuilles.',
       'Placali, sauce kplala, poisson fumé, crabe', 650, 550, '{poisson,crustacés}', 2000),
    ('Foutou banane sauce graine', v_cat_jour, 'Foutou pilé maison, sauce graine au poulet.',
       'Foutou banane, sauce graine de palme, poulet, aubergine', 880, 600, '{}', 2500),
    ('Spaghetti sautés', v_cat_jour, 'Spaghetti sautés comme au maquis : sauce tomate pimentée, légumes croquants et saucisse.',
       'Spaghetti, saucisse, tomate, poivron, carotte, oignons, piment', 640, 450, '{gluten}', 1500),
    ('Salade composée', v_cat_veg, 'Salade fraîche et croquante, œufs durs, vinaigrette citron.',
       'Laitue, concombre, maïs, carotte, chou rouge, œufs durs', 380, 350, '{œuf,moutarde}', 1500),
    -- Petit-déjeuner
    ('Pain beurre & café au lait', v_cat_bf, 'Pain frais beurré et grand café au lait sucré.',
       'Pain, beurre, café, lait, sucre', 420, 300, '{gluten,lait}', 500),
    ('Omelette pain', v_cat_bf, 'Omelette aux oignons et tomates dans un pain croustillant.',
       'Œufs, oignons, tomate, pain', 480, 280, '{œuf,gluten}', 500),
    ('Bouillie de mil', v_cat_bf, 'Bouillie de mil au lait, parfumée au citron.',
       'Mil, lait, sucre, citron', 350, 350, '{lait}', 500),
    -- Snack
    ('Crêpes sucrées', v_cat_snack, 'Trois crêpes maison au sucre ou au chocolat.',
       'Farine, œufs, lait, sucre, chocolat', 450, 200, '{gluten,œuf,lait}', 700),
    ('Brownie', v_cat_snack, 'Brownie fondant au chocolat.',
       'Chocolat, farine, œufs, beurre, sucre', 420, 120, '{gluten,œuf,lait}', 700),
    ('Pain perdu', v_cat_snack, 'Pain perdu doré à la cannelle.',
       'Pain, œufs, lait, sucre, cannelle', 400, 180, '{gluten,œuf,lait}', 700),
    ('Croque-monsieur', v_cat_snack, 'Croque-monsieur jambon fromage, bien gratiné.',
       'Pain de mie, jambon, fromage, beurre', 480, 200, '{gluten,lait}', 700);

  insert into public.extras (name, price, kind, sort) values
    ('Salade de fruits', 500, 'dessert', 1), ('Yaourt', 500, 'dessert', 2), ('Gâteau', 500, 'dessert', 3),
    ('Orange (coupée en 4)', 200, 'dessert', 4), ('Pastèque (une part)', 300, 'dessert', 5),
    ('Ananas (2 tranches)', 300, 'dessert', 6), ('Mangue (2 tranches)', 300, 'dessert', 7),
    ('Bissap', 300, 'drink', 14), ('Gnamakoudji', 300, 'drink', 15), ('Eau minérale', 200, 'drink', 16);
  -- Suppléments au choix à l'achat : une entrée et/ou un dessert (boissons désactivées)
  insert into public.extras (name, price, kind, sort) values
    ('Salade de crudités', 500, 'starter', 0), ('Avocat vinaigrette', 500, 'starter', 0);
  update public.extras set is_active = false where kind = 'drink';

  -- ───────────── Stock & recettes ─────────────
  insert into public.ingredients (name, unit, stock_qty, alert_threshold, unit_cost) values
    ('Attiéké', 'kg', 42, 15, 800), ('Poisson (carpe)', 'kg', 18, 10, 2500), ('Poulet', 'kg', 25, 10, 2800),
    ('Riz', 'kg', 60, 20, 600), ('Graine de palme', 'kg', 14, 8, 700), ('Pâte d''arachide', 'kg', 6, 5, 1500),
    ('Banane plantain', 'kg', 35, 15, 400), ('Manioc (placali)', 'kg', 12, 6, 500), ('Feuilles kplala', 'kg', 3, 4, 800),
    ('Tomate', 'kg', 20, 8, 700), ('Oignon', 'kg', 15, 6, 600), ('Huile', 'L', 22, 8, 1400),
    ('Spaghetti', 'kg', 10, 5, 900), ('Thon', 'kg', 4, 6, 2200), ('Crudités', 'kg', 9, 4, 1000),
    ('Pain', 'pièce', 120, 40, 100), ('Œufs', 'pièce', 180, 60, 100), ('Lait', 'L', 25, 10, 900),
    ('Farine', 'kg', 15, 5, 700), ('Sucre', 'kg', 12, 4, 800), ('Chocolat', 'kg', 4, 2, 4000), ('Mil', 'kg', 10, 4, 600);

  insert into public.recipe_lines (dish_id, ingredient_id, qty_per_portion)
  select d.id, i.id, r.qty
    from (values
      ('Attiéké poisson braisé', 'Attiéké', 0.25), ('Attiéké poisson braisé', 'Poisson (carpe)', 0.30),
      ('Attiéké poisson braisé', 'Tomate', 0.05), ('Attiéké poisson braisé', 'Oignon', 0.04),
      ('Garba', 'Attiéké', 0.25), ('Garba', 'Thon', 0.15), ('Garba', 'Huile', 0.05), ('Garba', 'Oignon', 0.03),
      ('Riz sauce graine', 'Riz', 0.18), ('Riz sauce graine', 'Graine de palme', 0.15),
      ('Riz sauce arachide poulet', 'Riz', 0.18), ('Riz sauce arachide poulet', 'Poulet', 0.25),
      ('Riz sauce arachide poulet', 'Pâte d''arachide', 0.08), ('Riz sauce arachide poulet', 'Tomate', 0.05),
      ('Alloco poulet braisé', 'Banane plantain', 0.40), ('Alloco poulet braisé', 'Poulet', 0.25),
      ('Alloco poulet braisé', 'Huile', 0.06),
      ('Placali sauce kplala', 'Manioc (placali)', 0.30), ('Placali sauce kplala', 'Feuilles kplala', 0.10),
      ('Foutou banane sauce graine', 'Banane plantain', 0.45), ('Foutou banane sauce graine', 'Graine de palme', 0.15),
      ('Foutou banane sauce graine', 'Poulet', 0.20),
      ('Spaghetti sautés', 'Spaghetti', 0.15), ('Spaghetti sautés', 'Tomate', 0.08), ('Spaghetti sautés', 'Huile', 0.03),
      ('Salade composée', 'Crudités', 0.25), ('Salade composée', 'Tomate', 0.06),
      ('Pain beurre & café au lait', 'Pain', 1), ('Pain beurre & café au lait', 'Lait', 0.2),
      ('Omelette pain', 'Œufs', 2), ('Omelette pain', 'Pain', 1), ('Bouillie de mil', 'Mil', 0.08), ('Bouillie de mil', 'Lait', 0.15),
      ('Crêpes sucrées', 'Farine', 0.08), ('Crêpes sucrées', 'Œufs', 1), ('Crêpes sucrées', 'Lait', 0.15),
      ('Brownie', 'Chocolat', 0.04), ('Brownie', 'Farine', 0.03), ('Brownie', 'Œufs', 1),
      ('Pain perdu', 'Pain', 1), ('Pain perdu', 'Œufs', 1), ('Pain perdu', 'Lait', 0.1),
      ('Croque-monsieur', 'Pain', 1)) as r(dish, ing, qty)
    join public.dishes d on d.name = r.dish
    join public.ingredients i on i.name = r.ing;

  insert into public.stock_movements (ingredient_id, type, qty, reason, created_by, created_at)
  select id, 'in', round((stock_qty * 0.4)::numeric, 1) + 1, 'Achat marché d''Adjamé', v_chef, now() - interval '2 days'
    from public.ingredients where name in ('Attiéké', 'Poulet', 'Riz', 'Banane plantain');

  -- ───────────── Salle ─────────────
  insert into public.rooms (name, total_tables, layout)
  values ('Réfectoire principal', 20,
          (select jsonb_agg(jsonb_build_object('id', 'T' || n, 'x', (n - 1) % 5, 'y', (n - 1) / 5, 'seats', 4) order by n)
             from generate_series(1, 20) n))
  returning id into v_room;

  -- ───────────── Menus : 4 semaines passées, semaine en cours, semaines suivantes ─────────────
  -- Règle : une semaine dont la date limite est passée est publiée ; la suivante est soumise.
  for wk in select (v_week + (w * 7))::date as ws from generate_series(-4, 2) w loop
    if now() > public.menu_deadline(wk.ws) then v_status := 'published';
    elsif not exists (select 1 from public.menus where status = 'submitted') then v_status := 'submitted';
    else continue;
    end if;
    insert into public.menus (week_start, status, submitted_at, published_at, created_by)
    values (wk.ws, v_status, public.menu_deadline(wk.ws) - interval '30 hours',
            case when v_status = 'published' then public.menu_deadline(wk.ws) - interval '20 hours' end, v_chef)
    returning id into v_menu;

    for k in 0..5 loop   -- lundi → samedi
      v_day := wk.ws + k;
      -- Rotation des plats principaux : 5 au déjeuner (4 le samedi), 4 au dîner ; 3 au petit-déjeuner, 3 au snack
      select array_agg(id order by md5(name || v_day::text)) into v_mains from public.dishes
       where category_id not in (v_cat_bf, v_cat_snack);
      v_dinner := v_mains[5:8];
      v_lunch := v_mains[1:case when k = 5 then 4 else 5 end];
      select id into v_dish from public.dishes where name = 'Attiéké poisson braisé';
      if not v_dish = any (v_lunch) then v_lunch[1] := v_dish; end if;
      select array_agg(id) into v_bf from public.dishes where category_id = v_cat_bf;
      select (array_agg(id order by md5(name || v_day::text)))[1:3] into v_sn from public.dishes where category_id = v_cat_snack;

      foreach v_svc in array enum_range(null::public.service_kind) loop
        if k = 5 and v_svc in ('dinner', 'snack') then continue; end if;
        foreach v_dish in array case v_svc when 'lunch' then v_lunch when 'dinner' then v_dinner
                                           when 'breakfast' then v_bf else v_sn end loop
          insert into public.menu_items (menu_id, service_date, service, dish_id, price, planned_qty)
          select v_menu, v_day, v_svc, id, base_price,
                 (case v_svc when 'lunch' then 40 when 'dinner' then 25 else 22 end *
                  case name when 'Attiéké poisson braisé' then 1.0 when 'Garba' then 0.9 when 'Alloco poulet braisé' then 0.85
                            when 'Riz sauce arachide poulet' then 0.8 when 'Riz sauce graine' then 0.7
                            when 'Foutou banane sauce graine' then 0.6 when 'Spaghetti sautés' then 0.55
                            when 'Placali sauce kplala' then 0.5 when 'Salade composée' then 0.4 else 1.0 end)::int
            from public.dishes where id = v_dish;
        end loop;
      end loop;
    end loop;
  end loop;

  -- ───────────── Ventes : tickets par type de repas ─────────────
  -- Services passés : N clients servis (le plat choisi au comptoir suit la popularité) + quelques tickets expirés.
  for v_item in
    select mi.service_date, mi.service from public.menu_items mi join public.menus m on m.id = mi.menu_id
     where m.status = 'published' group by 1, 2 order by 1, 2
  loop
    select * into v_win from public.service_window(v_item.service_date, v_item.service);
    continue when v_win.ends_at >= now();
    v_att := round(case v_item.service when 'lunch' then 150 when 'dinner' then 85 when 'breakfast' then 55 else 45 end
                   * (0.75 + 0.25 * random())
                   * case extract(isodow from v_item.service_date) when 1 then 0.85 when 5 then 1.1 when 6 then 0.7 else 1 end)::int;
    select array_agg(mi.id order by mi.id),
           array_agg(case d.name when 'Attiéké poisson braisé' then 1.0 when 'Garba' then 0.9 when 'Alloco poulet braisé' then 0.85
                       when 'Riz sauce arachide poulet' then 0.8 when 'Riz sauce graine' then 0.7 when 'Foutou banane sauce graine' then 0.6
                       when 'Spaghetti sautés' then 0.55 when 'Placali sauce kplala' then 0.5 when 'Salade composée' then 0.4
                       when 'Pain beurre & café au lait' then 1.0 when 'Omelette pain' then 0.8 when 'Bouillie de mil' then 0.5
                       when 'Crêpes sucrées' then 1.0 when 'Croque-monsieur' then 0.8 when 'Brownie' then 0.7 else 0.6 end
                     order by mi.id),
           array_agg(coalesce(mi.planned_qty, 999) order by mi.id)
      into v_items, v_weights, v_left
      from public.menu_items mi join public.dishes d on d.id = mi.dish_id
     where mi.service_date = v_item.service_date and mi.service = v_item.service;
    for i in 1..v_att loop
      -- tirage pondéré parmi les plats encore disponibles
      v_acc := 0; v_r := random() * (select sum(w) from unnest(v_weights, v_left) x(w, l) where l > 0); v_pick := null;
      for k in 1..array_length(v_items, 1) loop
        continue when v_left[k] <= 0;
        v_acc := v_acc + v_weights[k];
        if v_r <= v_acc then v_pick := k; exit; end if;
      end loop;
      exit when v_pick is null;
      v_left[v_pick] := v_left[v_pick] - 1;
      v_t := v_win.starts_at - (interval '30 minutes' + random() * interval '40 hours');
      insert into seed_sales values (v_items[v_pick], v_clients[2 + floor(random() * 29)::int], v_t, 'used',
        case when v_item.service in ('lunch', 'dinner') then
          case when random() < 0.15 then array[(select id from public.extras where kind = 'starter' order by random() limit 1)] else '{}'::uuid[] end
          || case when random() < 0.25 then array[(select id from public.extras where kind = 'dessert' and is_active order by random() limit 1)] else '{}'::uuid[] end
        else '{}'::uuid[] end,
        v_item.service, v_item.service_date,
        v_win.starts_at + random() * (v_win.ends_at - v_win.starts_at - interval '15 minutes'));
    end loop;
    -- tickets achetés mais jamais utilisés (expirés 48 h après l'achat)
    for i in 1..round(v_att * 0.06)::int loop
      v_t := v_win.starts_at - (interval '1 hour' + random() * interval '20 hours');
      continue when v_t + interval '48 hours' > now();
      insert into seed_sales values (null, v_clients[2 + floor(random() * 29)::int], v_t, 'expired', '{}', v_item.service, null, null);
    end loop;
  end loop;

  -- Tickets en circulation (achetés ces dernières 30 h, encore valables)
  foreach v_svc in array enum_range(null::public.service_kind) loop
    for i in 1..(case v_svc when 'lunch' then 70 when 'dinner' then 40 when 'breakfast' then 25 else 20 end) loop
      insert into seed_sales values (null, v_clients[2 + floor(random() * 29)::int],
        now() - (interval '10 minutes' + random() * interval '30 hours'), 'valid',
        case when v_svc in ('lunch', 'dinner') and random() < 0.25
             then array[(select id from public.extras where kind = 'dessert' and is_active order by random() limit 1)] else '{}'::uuid[] end,
        v_svc, null, null);
    end loop;
  end loop;

  -- Démo : la cliente principale (attiéké au déjeuner presque tous les jours, un ticket expiré, 3 tickets en poche)
  insert into seed_sales
  select mi.id, v_demo, w.starts_at - interval '20 hours', 'used', array[(select id from public.extras where name = 'Mangue (2 tranches)')],
         'lunch', mi.service_date, w.starts_at + interval '45 minutes'
    from public.menu_items mi join public.menus m on m.id = mi.menu_id
    cross join lateral public.service_window(mi.service_date, mi.service) w
   where m.status = 'published' and mi.service = 'lunch' and w.ends_at < now()
     and mi.dish_id = (select id from public.dishes where name = 'Attiéké poisson braisé')
     and mi.service_date between v_today - 12 and v_today and extract(isodow from mi.service_date) <> 3;
  insert into seed_sales values
    (null, v_demo, now() - interval '5 days', 'expired', '{}', 'dinner', null, null),
    (null, v_demo, now() - interval '3 hours', 'valid', array[(select id from public.extras where name = 'Mangue (2 tranches)')], 'lunch', null, null),
    (null, v_demo, now() - interval '3 hours', 'valid', '{}', 'lunch', null, null),
    (null, v_demo, now() - interval '2 hours', 'valid', '{}', 'breakfast', null, null);

  -- Traitement chronologique : recharge quand le solde manque, puis achat (prix du type de ticket + suppléments)
  for s in select ss.*, mi.dish_id, d.name as dish_name
             from seed_sales ss left join public.menu_items mi on mi.id = ss.menu_item_id left join public.dishes d on d.id = mi.dish_id
            order by ss.created_at
  loop
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'kind', e.kind, 'price', e.price)), '[]'),
           (v_prices -> s.service::text ->> 'price')::int + coalesce(sum(e.price), 0)
      into v_extras, v_total
      from public.extras e where e.id = any (s.extra_ids);
    select balance into v_bal from public.wallets where user_id = s.user_id for update;

    if v_bal < v_total then
      if random() < 0.7 then
        v_tx := public._wallet_move(s.user_id, (array[5000, 10000, 10000, 20000, 25000])[1 + floor(random() * 5)::int],
                                    'recharge', p_note => 'Mobile Money (simulation)');
      else
        v_tx := public._wallet_move(s.user_id, (array[5000, 10000, 15000])[1 + floor(random() * 3)::int],
                                    'recharge_cash', p_performed_by => v_caisse, p_note => 'Espèces (caisse)');
      end if;
      update public.transactions set created_at = s.created_at - interval '3 minutes' where id = v_tx.id;
    end if;

    insert into public.tickets (user_id, buyer_id, service, menu_item_id, dish_id, extras, total, status, service_date,
                                valid_from, valid_until, used_at, scanned_by, created_at)
    values (s.user_id, s.user_id, s.service, s.menu_item_id, s.dish_id, v_extras, v_total, s.status, s.service_date,
            s.created_at, s.created_at + interval '48 hours', s.used_at, case when s.status = 'used' then v_agent end, s.created_at)
    returning id into v_ticket;
    v_tx := public._wallet_move(s.user_id, -v_total, 'purchase', p_ticket => v_ticket,
              p_note => '1 × ticket ' || (v_prices -> s.service::text ->> 'label'));
    update public.transactions set created_at = s.created_at where id = v_tx.id;
  end loop;

  -- Un transfert et un crédit caisse visibles dans l'historique de la démo
  perform 1 from public.wallets where user_id in (v_demo, v_clients[2]) order by user_id for update;
  v_tx := public._wallet_move(v_clients[2], 5000, 'recharge', p_note => 'Mobile Money (simulation)');
  update public.transactions set created_at = now() - interval '3 days 2 hours' where id = v_tx.id;
  v_tx := public._wallet_move(v_clients[2], -3000, 'transfer_out', p_counterpart => v_demo, p_note => 'Pour ton déj 😉');
  update public.transactions set created_at = now() - interval '3 days' where id = v_tx.id;
  v_tx := public._wallet_move(v_demo, 3000, 'transfer_in', p_counterpart => v_clients[2], p_note => 'Pour ton déj 😉');
  update public.transactions set created_at = now() - interval '3 days' where id = v_tx.id;
  v_tx := public._wallet_move(v_demo, 15000, 'recharge_cash', p_performed_by => v_caisse, p_note => 'Espèces (caisse)');
  update public.transactions set created_at = now() - interval '1 day' where id = v_tx.id;

  -- Compteurs dérivés des tickets
  update public.menu_items mi set
    sold_qty   = (select count(*) from public.tickets t where t.menu_item_id = mi.id and t.status = 'used'),
    served_qty = (select count(*) from public.tickets t where t.menu_item_id = mi.id and t.status = 'used');
  update public.menu_items mi set prepared_qty = served_qty + floor(random() * 6)::int
   where (select ends_at from public.service_window(mi.service_date, mi.service)) < now();
  -- Une rupture déclarée et un plat presque épuisé pour la démo
  update public.menu_items set is_sold_out = true
   where id = (select mi.id from public.menu_items mi join public.dishes d on d.id = mi.dish_id
                where mi.service_date > v_today and d.name = 'Placali sauce kplala' order by mi.service_date limit 1);

  update public.profiles p set points = least(14, (select count(*) from public.tickets t where t.user_id = p.id and t.status = 'used'))
   where role = 'client';
  update public.profiles set points = 12 where id = v_demo;

  -- Avis sur ~35 % des repas servis
  insert into public.ratings (ticket_id, user_id, dish_id, stars, comment, author, created_at)
  select t.id, t.user_id, t.dish_id,
         case when random() < 0.55 then 5 when random() < 0.7 then 4 when random() < 0.8 then 3 else 2 end
           - case when d.name in ('Placali sauce kplala', 'Salade composée') and random() < 0.4 then 1 else 0 end,
         case when random() < 0.25 then (array['Très bon, comme à la maison !', 'Portion généreuse 👍', 'Un peu trop pimenté pour moi',
                                                'Le poisson était parfait', 'Sauce excellente', 'Service rapide grâce au QR',
                                                'Un peu froid ce midi', 'Je recommande !'])[1 + floor(random() * 8)::int] end,
         split_part(p.full_name, ' ', 1),
         t.used_at + interval '1 hour'
    from public.tickets t join public.dishes d on d.id = t.dish_id join public.profiles p on p.id = t.user_id
   where t.status = 'used' and random() < 0.35;

  -- Affluence : un relevé toutes les 10 minutes pendant les services passés (courbe en cloche)
  for v_item in select distinct service_date, service from public.menu_items
                 where (select ends_at from public.service_window(service_date, service)) < now() loop
    select * into v_win from public.service_window(v_item.service_date, v_item.service);
    v_t := v_win.starts_at;
    while v_t <= v_win.ends_at loop
      v_rate := greatest(0, least(100, 95 * exp(-power(extract(epoch from v_t - (v_win.starts_at + (v_win.ends_at - v_win.starts_at) * 0.35)) / 2400, 2))
                                     * case v_item.service when 'dinner' then 0.7 else 1 end + (random() * 10 - 5)));
      k := round(20 * v_rate / 100)::int;
      insert into public.occupancy_snapshots (room_id, occupied_tables, total_tables, rate, people_count, table_states, created_at)
      values (v_room, k, 20, round(k * 5.0, 2), round(k * (2 + random() * 2))::int,
              (select jsonb_object_agg('T' || n, n <= k) from generate_series(1, 20) n), v_t);
      v_t := v_t + interval '10 minutes';
    end loop;
  end loop;

  -- Notifications : on garde un fil propre pour la démo
  delete from public.notifications;
  insert into public.notifications (user_id, type, title, body, data, read_at, created_at) values
    (v_demo, 'menu_published', 'Le menu de la semaine est disponible 🍽️', 'Découvrez les plats de la semaine et réservez vos repas.', '{}', now() - interval '2 days', now() - interval '3 days'),
    (v_demo, 'transfer_received', 'Transfert reçu', (select full_name from public.profiles where id = v_clients[2]) || ' vous a envoyé 3' || U&'\00A0' || '000' || U&'\00A0' || 'FCFA.', '{}', now() - interval '3 days', now() - interval '3 days'),
    (v_demo, 'wallet_credited', 'Compte crédité', '15' || U&'\00A0' || '000' || U&'\00A0' || 'FCFA ajoutés à votre solde à la caisse.', '{}', null, now() - interval '1 day');
  insert into public.notifications (user_id, type, title, body, data, created_at)
  select v_chef, 'stock_low', 'Stock bas : ' || name, 'Reste ' || trim(to_char(stock_qty, 'FM999990.###')) || ' ' || unit || '.',
         jsonb_build_object('ingredient_id', id), now() - interval '5 hours'
    from public.ingredients where stock_qty < alert_threshold;

  raise notice 'Seed : % clients, % tickets, % transactions',
    array_length(v_clients, 1), (select count(*) from public.tickets), (select count(*) from public.transactions);
end $$;

drop table seed_sales;

-- Popularité de départ des plats (même valeurs que la migration dish_popularity)
update public.dishes d set popularity_prior = v.p from (values
  ('Alloco poulet braisé', 1.45), ('Attiéké poisson braisé', 1.35), ('Garba', 1.30),
  ('Foutou banane sauce graine', 1.05), ('Placali sauce kplala', 0.80),
  ('Riz sauce arachide poulet', 0.90), ('Riz sauce graine', 0.80), ('Spaghetti sautés', 0.90), ('Salade composée', 0.65),
  ('Pain beurre & café au lait', 1.30), ('Omelette pain', 1.10), ('Bouillie de mil', 0.70),
  ('Crêpes sucrées', 1.25), ('Croque-monsieur', 1.05), ('Brownie', 0.95), ('Pain perdu', 0.90)
) v(name, p) where d.name = v.name;

do $$
declare v_dish uuid; v_pdt uuid;
begin
  if exists (select 1 from dishes where name = 'Poulet frites') then raise notice 'déjà fait'; return; end if;
  insert into dishes (name, category_id, description, composition, kcal, weight_g, allergens, base_price, popularity_prior,
                      photo_url, photo_credit, photo_source)
  values ('Poulet frites', (select id from categories where name = 'Grillades'),
          'Poulet pané croustillant, frites maison et sauce, avec quelques crudités.',
          'Poulet, pommes de terre, huile, chapelure, crudités', 950, 450, '{gluten}', 2500, 1.55,
          'https://punghxwtknejxkedaoty.supabase.co/storage/v1/object/public/dishes/poulet-frites-v1.jpg',
          'Photo : Pexels · licence Pexels', 'https://www.pexels.com/photo/crispy-chicken-with-fries-sauce-and-salad-15390177/')
  returning id into v_dish;
  insert into ingredients (name, unit, stock_qty, alert_threshold, unit_cost) values ('Pomme de terre', 'kg', 40, 15, 800)
    on conflict (name) do nothing;
  insert into recipe_lines (dish_id, ingredient_id, qty_per_portion)
  select v_dish, id, q from (values ('Poulet', 0.25), ('Pomme de terre', 0.3), ('Huile', 0.06)) r(n, q) join ingredients on name = r.n;
  -- Au menu à partir de lundi : déjeuner lun / mer / ven, dîner mar / jeu
  insert into menu_items (menu_id, service_date, service, dish_id, price, planned_qty)
  select m.id, m.week_start + k, case when k in (0, 2, 4) then 'lunch' else 'dinner' end::service_kind, v_dish, 2500,
         case when k in (0, 2, 4) then 35 else 25 end
    from menus m cross join generate_series(0, 4) k
   where m.week_start + k >= current_date + 1;
end $$;

-- Règle « ticket jamais scanné = remboursé à l'expiration » appliquée à l'historique généré
do $$
declare v_t record; v_tx public.transactions; n int := 0;
begin
  for v_t in select k.* from tickets k
              where k.status = 'expired' and k.total > 0
                and not exists (select 1 from transactions t where t.ticket_id = k.id and t.type = 'refund')
              order by k.valid_until loop
    perform 1 from wallets where user_id = v_t.buyer_id for update;
    v_tx := public._wallet_move(v_t.buyer_id, v_t.total, 'refund', p_ticket => v_t.id,
                                p_note => 'Remboursement automatique · ticket ' || public.service_label(v_t.service) || ' non utilisé');
    update transactions set created_at = v_t.valid_until where id = v_tx.id;
    n := n + 1;
  end loop;
  raise notice '% tickets expirés remboursés', n;
end $$;

-- Photos des plats du petit-déjeuner et du snack (Pexels, licence libre), servies depuis public/dishes/
update public.dishes d set photo_url = v.url, photo_credit = 'Photo : Pexels · licence Pexels', photo_source = v.src from (values
  ('Pain beurre & café au lait', '/dishes/pain-beurre-cafe.jpg', 'https://www.pexels.com/photo/spreading-butter-on-the-bread-15703465/'),
  ('Omelette pain', '/dishes/omelette-pain.jpg', 'https://www.pexels.com/photo/close-up-of-a-sandwich-cut-in-half-25049048/'),
  ('Bouillie de mil', '/dishes/bouillie-mil.jpg', 'https://www.pexels.com/photo/a-golden-spoon-in-a-bowl-of-oatmeal-4725748/'),
  ('Crêpes sucrées', '/dishes/crepes-sucrees.jpg', 'https://www.pexels.com/photo/crepes-with-strawberries-11653564/'),
  ('Brownie', '/dishes/brownie.jpg', 'https://www.pexels.com/photo/a-plate-of-brownies-4765839/'),
  ('Pain perdu', '/dishes/pain-perdu.jpg', 'https://www.pexels.com/photo/close-up-french-toast-with-strawberries-on-the-side-11577595/'),
  ('Croque-monsieur', '/dishes/croque-monsieur.jpg', 'https://www.pexels.com/photo/ham-and-cheese-toasts-15110224/')
) v(name, url, src) where d.name = v.name;

-- Photos des plats du déjeuner et du dîner rapatriées dans public/dishes/ (plus de dépendance au stockage d'un projet)
update public.dishes d set photo_url = v.url, photo_credit = v.credit, photo_source = v.src from (values
  ('Alloco poulet braisé', '/dishes/alloco-poulet.jpg', null, null),
  ('Attiéké poisson braisé', '/dishes/attieke-poisson.jpg', 'Image générée par IA (Gamma) · illustration', null),
  ('Foutou banane sauce graine', '/dishes/foutou-sauce-graine.jpg', 'Photo : Fimalisa · CC BY-SA 4.0 · Wikimedia Commons', 'https://commons.wikimedia.org/wiki/File:Foutou_%C3%A0_la_sauce_graine.JPG'),
  ('Garba', '/dishes/garba.jpg', 'Photo : Cyriac Gbogou · CC BY-SA 3.0 · Wikimedia Commons', 'https://commons.wikimedia.org/wiki/File:Le_garba.jpg'),
  ('Placali sauce kplala', '/dishes/placali-kplala.jpg', 'Photo : Cyriac Gbogou · CC BY-SA 4.0 · Wikimedia Commons', 'https://commons.wikimedia.org/wiki/File:Placali_et_sauce.jpg'),
  ('Poulet frites', '/dishes/poulet-frites.jpg', 'Photo : Pexels · licence Pexels', 'https://www.pexels.com/photo/crispy-chicken-with-fries-sauce-and-salad-15390177/'),
  ('Riz sauce arachide poulet', '/dishes/riz-sauce-arachide.jpg', null, null),
  ('Riz sauce graine', '/dishes/riz-sauce-graine.jpg', null, null),
  ('Salade composée', '/dishes/salade-composee.jpg', 'Photo : Pexels', 'https://www.pexels.com/photo/bowl-of-vegetable-salad-406152/'),
  ('Spaghetti sautés', '/dishes/spaghetti-sautes.jpg', 'Photo : Pexels', 'https://www.pexels.com/photo/closeup-of-a-dish-with-noodles-14079234/')
) v(name, url, credit, src) where d.name = v.name;
