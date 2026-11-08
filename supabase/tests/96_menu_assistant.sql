-- Agent menu : contexte pour l'IA et application de la proposition au brouillon
begin;
select tests.setup();
select date_trunc('week', public.today_abidjan() + 14)::date as w \gset

select tests.login('alice');
select tests.throws(format($$select public.menu_ai_context(%L)$$, :'w'), 'client : contexte du menu interdit');
select tests.code(public.apply_menu_proposal(:'w', '[]'), 'FORBIDDEN', 'client : application interdite');

select tests.login('chef');
select tests.ok(jsonb_array_length(public.menu_ai_context(:'w') -> 'plats') = 3, 'contexte : plats actifs avec popularité, coût, services possibles');
select tests.eq(jsonb_array_length(public.menu_ai_context(:'w') -> 'jours'), 6, 'contexte : lundi → samedi');
select id as attieke from public.dishes where name = 'Attiéké poisson braisé' \gset
select tests.eq((public.apply_menu_proposal(:'w', jsonb_build_array(
    jsonb_build_object('date', :'w', 'service', 'lunch', 'dish_id', :'attieke', 'planned_qty', 40),
    jsonb_build_object('date', (:'w'::date + 1), 'service', 'dinner', 'dish_id', :'attieke', 'planned_qty', 9999),
    jsonb_build_object('date', (:'w'::date + 30), 'service', 'lunch', 'dish_id', :'attieke', 'planned_qty', 10))) ->> 'added')::int, 2,
  'proposition appliquée (date hors semaine ignorée)');
select tests.eq((select planned_qty from public.menu_items mi join public.menus m on m.id = mi.menu_id
                  where m.week_start = :'w' and mi.service = 'dinner'), 500, 'quantité plafonnée à 500');
select tests.eq((select status::text from public.menus where week_start = :'w'), 'draft', 'menu créé en brouillon (à valider par le chef)');
rollback;
