-- Outils de test + jeu de données minimal. Appliqué après les migrations (Postgres local uniquement).
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Identifiants fixes
create function tests.uid(p_name text) returns uuid language sql immutable as $$
  select case p_name
    when 'alice'  then '00000000-0000-0000-0000-00000000a001'
    when 'bob'    then '00000000-0000-0000-0000-00000000b001'
    when 'agent'  then '00000000-0000-0000-0000-00000000a6e1'
    when 'agent2' then '00000000-0000-0000-0000-00000000a6e2'
    when 'caisse' then '00000000-0000-0000-0000-00000000ca51'
    when 'chef'   then '00000000-0000-0000-0000-00000000c4ef'
    when 'admin'  then '00000000-0000-0000-0000-00000000ad01'
  end::uuid
$$;

create function tests.item(p_name text) returns uuid language sql immutable as $$
  select case p_name
    when 'attieke_lunch'  then '00000000-0000-0000-0001-000000000001'
    when 'garba_lunch'    then '00000000-0000-0000-0001-000000000002'
    when 'attieke_dinner' then '00000000-0000-0000-0001-000000000003'
    when 'vip_dinner'     then '00000000-0000-0000-0001-000000000004'
    when 'omelette_bf'    then '00000000-0000-0000-0001-000000000005'
  end::uuid
$$;

create function tests.extra(p_name text) returns uuid language sql immutable as $$
  select case p_name
    when 'dessert' then '00000000-0000-0000-0002-000000000001'
    when 'bissap'  then '00000000-0000-0000-0002-000000000002'
    when 'crudites' then '00000000-0000-0000-0002-000000000003'
    when 'avocat'  then '00000000-0000-0000-0002-000000000004'
  end::uuid
$$;

-- Simule une requête PostgREST d'un utilisateur connecté
create function tests.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', tests.uid(p_name), 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;
create function tests.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
  select set_config('role', 'anon', true);
$$;
create function tests.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select set_config('role', 'service_role', true);
$$;
create function tests.logout() returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
  select set_config('role', 'none', true);
$$;

create function tests.ok(p_cond boolean, p_desc text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ÉCHEC : %', p_desc; end if;
  raise notice 'ok - %', p_desc;
end $$;

create function tests.eq(p_got anyelement, p_expected anyelement, p_desc text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_expected then
    raise exception 'ÉCHEC : % (obtenu %, attendu %)', p_desc, p_got, p_expected;
  end if;
  raise notice 'ok - %', p_desc;
end $$;

-- Vérifie qu'un résultat RPC est un échec avec le code attendu
create function tests.code(p_res jsonb, p_code text, p_desc text) returns void language plpgsql as $$
begin
  if coalesce(p_res ->> 'code', 'OK') <> p_code then
    raise exception 'ÉCHEC : % (attendu %, obtenu %)', p_desc, p_code, p_res;
  end if;
  raise notice 'ok - % [%]', p_desc, p_code;
end $$;

-- Vérifie qu'une requête lève une erreur (droits, RLS, contrainte…)
create function tests.throws(p_sql text, p_desc text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok - % (refusé : %)', p_desc, sqlerrm;
    return;
  end;
  raise exception 'ÉCHEC : % — la requête aurait dû être refusée', p_desc;
end $$;

-- Invariant : solde = somme des transactions = balance_after de la dernière transaction
create function tests.check_ledger() returns void language plpgsql security definer as $$
declare v_bad int;
begin
  select count(*) into v_bad from public.wallets w
   where w.balance <> coalesce((select sum(amount) from public.transactions t where t.user_id = w.user_id), 0)
      or w.balance < 0;
  perform tests.eq(v_bad, 0, 'invariant : solde = somme des transactions pour tous les comptes');
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Jeu de données : utilisateurs, plats, menu publié pour demain
create function tests.setup() returns void language plpgsql as $$
declare
  d date := public.today_abidjan() + 1;
  v_menu uuid;
  v_ing uuid;
  v_attieke uuid; v_garba uuid; v_vip uuid; v_cat int;
  r record;
begin
  for r in select * from (values
      ('alice',  'Alice Kouassi', '+2250701020304', 'client'),
      ('bob',    'Bob Traoré',    '+2250505050505', 'client'),
      ('agent',  'Agent Yao',     null,             'agent'),
      ('agent2', 'Agent Koné',    null,             'agent'),
      ('caisse', 'Caisse Awa',    null,             'caissier'),
      ('chef',   'Chef Ibrahim',  null,             'chef'),
      ('admin',  'Admin Bryan',   null,             'admin')) as t(n, full_name, phone, role)
  loop
    insert into auth.users (id, email, raw_user_meta_data)
    values (tests.uid(r.n), r.n || '@dabali.test', jsonb_build_object('full_name', r.full_name, 'phone', r.phone));
    update public.profiles set role = r.role::public.user_role where id = tests.uid(r.n);
  end loop;

  insert into public.categories (name, sort) values ('Plat du jour', 1) returning id into v_cat;
  insert into public.dishes (name, category_id, composition, base_price)
    values ('Attiéké poisson braisé', v_cat, 'Attiéké, poisson braisé, sauce tomate, oignons', 2500) returning id into v_attieke;
  insert into public.dishes (name, category_id, base_price) values ('Garba', v_cat, 1500) returning id into v_garba;
  insert into public.dishes (name, category_id, base_price) values ('Plateau VIP', v_cat, 6000) returning id into v_vip;
  insert into public.ingredients (name, unit, stock_qty, alert_threshold, unit_cost)
    values ('Poisson', 'kg', 10, 9.9, 3000) returning id into v_ing;
  insert into public.recipe_lines values (v_attieke, v_ing, 0.2);
  insert into public.extras (id, name, price, kind) values
    (tests.extra('dessert'),  'Salade de fruits', 500, 'dessert'),
    (tests.extra('crudites'), 'Salade de crudités', 500, 'starter'),
    (tests.extra('avocat'),   'Avocat vinaigrette', 500, 'starter');
  insert into public.extras (id, name, price, kind, is_active) values (tests.extra('bissap'), 'Bissap', 300, 'drink', false);

  insert into public.menus (week_start, status, published_at)
    values (date_trunc('week', d)::date, 'published', now()) returning id into v_menu;
  insert into public.menu_items (id, menu_id, service_date, service, dish_id, price, planned_qty) values
    (tests.item('attieke_lunch'),  v_menu, d, 'lunch',  v_attieke, 2500, 2),
    (tests.item('garba_lunch'),    v_menu, d, 'lunch',  v_garba,   1500, null),
    (tests.item('attieke_dinner'), v_menu, d, 'dinner', v_attieke, 2500, 50),
    (tests.item('vip_dinner'),     v_menu, d, 'dinner', v_vip,     6000, 10),
    (tests.item('omelette_bf'),    v_menu, d, 'breakfast', v_garba, 500, 30);
end $$;
