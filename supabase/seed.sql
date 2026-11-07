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
  menu_item_id uuid, user_id uuid, created_at timestamptz, status public.ticket_status, extra_ids uuid[]
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
  v_cat_jour int; v_cat_grill int; v_cat_veg int;
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
  insert into public.categories (name, sort) values ('Desserts', 4), ('Boissons', 5);

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
       'Laitue, concombre, maïs, carotte, chou rouge, œufs durs', 380, 350, '{œuf,moutarde}', 1500);

  insert into public.extras (name, price, kind, sort) values
    ('Salade de fruits', 500, 'dessert', 1), ('Yaourt', 500, 'dessert', 2), ('Gâteau', 500, 'dessert', 3),
    ('Bissap', 300, 'drink', 4), ('Gnamakoudji', 300, 'drink', 5), ('Eau minérale', 200, 'drink', 6);

  -- ───────────── Stock & recettes ─────────────
  insert into public.ingredients (name, unit, stock_qty, alert_threshold, unit_cost) values
    ('Attiéké', 'kg', 42, 15, 800), ('Poisson (carpe)', 'kg', 18, 10, 2500), ('Poulet', 'kg', 25, 10, 2800),
    ('Riz', 'kg', 60, 20, 600), ('Graine de palme', 'kg', 14, 8, 700), ('Pâte d''arachide', 'kg', 6, 5, 1500),
    ('Banane plantain', 'kg', 35, 15, 400), ('Manioc (placali)', 'kg', 12, 6, 500), ('Feuilles kplala', 'kg', 3, 4, 800),
    ('Tomate', 'kg', 20, 8, 700), ('Oignon', 'kg', 15, 6, 600), ('Huile', 'L', 22, 8, 1400),
    ('Spaghetti', 'kg', 10, 5, 900), ('Thon', 'kg', 4, 6, 2200), ('Crudités', 'kg', 9, 4, 1000);

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
      ('Salade composée', 'Crudités', 0.25), ('Salade composée', 'Tomate', 0.06)) as r(dish, ing, qty)
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
      -- Rotation des plats : 5 au déjeuner (4 le samedi), 4 au dîner
      select array_agg(id order by md5(name || v_day::text)) into v_lunch from public.dishes;
      v_dinner := v_lunch[5:8];
      v_lunch := v_lunch[1:case when k = 5 then 4 else 5 end];
      -- L'attiéké poisson est servi tous les midis (plat phare)
      select id into v_dish from public.dishes where name = 'Attiéké poisson braisé';
      if not v_dish = any (v_lunch) then v_lunch[1] := v_dish; end if;

      foreach v_svc in array array['lunch', 'dinner']::public.service_kind[] loop
        if k = 5 and v_svc = 'dinner' then continue; end if;
        foreach v_dish in array case v_svc when 'lunch' then v_lunch else v_dinner end loop
          insert into public.menu_items (menu_id, service_date, service, dish_id, price, planned_qty)
          select v_menu, v_day, v_svc, id, base_price,
                 (case v_svc when 'lunch' then 40 else 25 end *
                  case name when 'Attiéké poisson braisé' then 1.0 when 'Garba' then 0.9 when 'Alloco poulet braisé' then 0.85
                            when 'Riz sauce arachide poulet' then 0.8 when 'Riz sauce graine' then 0.7
                            when 'Foutou banane sauce graine' then 0.6 when 'Spaghetti sautés' then 0.55
                            when 'Placali sauce kplala' then 0.5 else 0.4 end)::int
            from public.dishes where id = v_dish;
        end loop;
      end loop;
    end loop;
  end loop;

  -- ───────────── Ventes : historique + précommandes ─────────────
  for v_item in
    select mi.*, d.name as dish_name, m.status as menu_status
      from public.menu_items mi join public.menus m on m.id = mi.menu_id join public.dishes d on d.id = mi.dish_id
     where m.status = 'published'
  loop
    select * into v_win from public.service_window(v_item.service_date, v_item.service);
    if v_win.ends_at < now() then
      -- service passé : ventes réalistes (lundi plus calme, vendredi plus chargé)
      v_n := least(v_item.planned_qty, round(v_item.planned_qty * (0.55 + 0.4 * random()) *
             case extract(isodow from v_item.service_date) when 1 then 0.85 when 5 then 1.1 when 6 then 0.7 else 1 end)::int);
    elsif v_item.service_date <= v_today + 7 then
      -- service à venir : précommandes, plus nombreuses quand le service approche
      v_n := round(v_item.planned_qty * greatest(0.05, 0.6 - 0.08 * (v_item.service_date - v_today)) * (0.6 + 0.6 * random()))::int;
      v_n := least(v_n, v_item.planned_qty - 2);
    else
      v_n := 0;
    end if;

    for i in 1..greatest(v_n, 0) loop
      insert into seed_sales values (
        v_item.id,
        v_clients[2 + floor(random() * 29)::int],
        least(now() - interval '5 minutes', v_win.starts_at - (interval '20 minutes' + random() * interval '40 hours')),
        (case when v_win.ends_at >= now() then 'valid'
              when random() < 0.08 then 'expired' else 'used' end)::public.ticket_status,
        case when random() < 0.3 then array[(select id from public.extras where kind = 'drink' order by random() limit 1)] else '{}' end
          || case when random() < 0.2 then array[(select id from public.extras where kind = 'dessert' order by random() limit 1)] else '{}'::uuid[] end);
    end loop;
  end loop;

  -- Démo : la cliente principale a des tickets dans chaque statut
  insert into seed_sales
  select mi.id, v_demo, w.starts_at - interval '1 day',
         case when w.ends_at < now() then (case when row_number() over (order by mi.service_date, mi.service) % 4 = 0
                                                then 'expired' else 'used' end)::public.ticket_status
              else 'valid' end,
         array[(select id from public.extras where name = 'Bissap')]
    from public.menu_items mi
    cross join lateral public.service_window(mi.service_date, mi.service) w
   where mi.dish_id = (select id from public.dishes where name = 'Attiéké poisson braisé')
     and mi.service_date between v_today - 12 and v_today + 3
     and exists (select 1 from public.menus m where m.id = mi.menu_id and m.status = 'published');

  -- Traitement chronologique : recharge quand le solde manque, puis achat
  for s in select ss.*, mi.price, mi.service_date, mi.service, mi.dish_id, d.name as dish_name
             from seed_sales ss join public.menu_items mi on mi.id = ss.menu_item_id join public.dishes d on d.id = mi.dish_id
            order by ss.created_at
  loop
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'kind', e.kind, 'price', e.price, 'free', false)), '[]'),
           s.price + coalesce(sum(e.price), 0)
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

    select * into v_win from public.service_window(s.service_date, s.service);
    insert into public.tickets (user_id, buyer_id, menu_item_id, dish_id, extras, total, status, service_date, service,
                                valid_from, valid_until, used_at, scanned_by, created_at)
    values (s.user_id, s.user_id, s.menu_item_id, s.dish_id, v_extras, v_total, s.status, s.service_date, s.service,
            v_win.starts_at, v_win.ends_at,
            case when s.status = 'used' then v_win.starts_at + random() * (v_win.ends_at - v_win.starts_at - interval '20 minutes') end,
            case when s.status = 'used' then v_agent end,
            s.created_at)
    returning id into v_ticket;
    v_tx := public._wallet_move(s.user_id, -v_total, 'purchase', p_ticket => v_ticket, p_note => s.dish_name);
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
    sold_qty   = (select count(*) from public.tickets t where t.menu_item_id = mi.id and t.status <> 'cancelled'),
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
