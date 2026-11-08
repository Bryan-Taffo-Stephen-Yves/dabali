-- Agent IA « menu de la semaine » : contexte envoyé à l'IA + application de la proposition au brouillon.

-- Tout ce que l'IA doit savoir pour proposer un menu (réservé à la cuisine)
create function public.menu_ai_context(p_week_start date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role('chef') then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'semaine', p_week_start,
    'jours', (select jsonb_agg(jsonb_build_object('date', p_week_start + k, 'jour', to_char(p_week_start + k, 'TMDay'),
                'services', case when k = 5 then '["breakfast","lunch"]'::jsonb else '["breakfast","lunch","snack","dinner"]'::jsonb end))
              from generate_series(0, 5) k),
    'services', public.setting('services'),
    'plats', (select jsonb_agg(jsonb_build_object(
                'id', d.id, 'nom', d.name, 'categorie', c.name, 'prix', d.base_price,
                'services_possibles', case c.name when 'Petit-déjeuner' then '["breakfast"]'::jsonb when 'Snack' then '["snack"]'::jsonb
                                                  else '["lunch","dinner"]'::jsonb end,
                'popularite', round(p.popularity, 2), 'note', p.stars,
                'plaintes_30j', (select count(*) from ratings r where r.dish_id = d.id and cardinality(r.complaints) > 0 and r.created_at > now() - interval '30 days'),
                'cout_portion', (select coalesce(round(sum(rl.qty_per_portion * i.unit_cost)), 0) from recipe_lines rl join ingredients i on i.id = rl.ingredient_id where rl.dish_id = d.id),
                'ingredient_en_rupture', (select bool_or(i.stock_qty < i.alert_threshold) from recipe_lines rl join ingredients i on i.id = rl.ingredient_id where rl.dish_id = d.id)
              ) order by c.name, p.popularity desc)
              from dishes d join categories c on c.id = d.category_id join public._dish_popularity(p_week_start) p on p.dish_id = d.id
             where d.is_active),
    'repas_attendus', (select jsonb_agg(jsonb_build_object('jour_semaine', dow, 'service', service, 'moyenne', moy) order by dow, service)
                         from (select extract(isodow from t.service_date)::int dow, t.service, round(count(*)::numeric / 4) moy
                                 from tickets t where t.status = 'used' and t.service_date >= p_week_start - 28 and t.service_date < p_week_start
                                group by 1, 2) x),
    'menus_recents', (select jsonb_agg(jsonb_build_object('date', mi.service_date, 'service', mi.service, 'plat', d.name) order by mi.service_date)
                        from menu_items mi join menus m on m.id = mi.menu_id join dishes d on d.id = mi.dish_id
                       where mi.service_date between p_week_start - 14 and p_week_start - 1));
end $$;

-- Applique la proposition (validée par le chef) au brouillon de la semaine
create function public.apply_menu_proposal(p_week_start date, p_items jsonb, p_replace boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_menu uuid; v_status menu_status; v_n int; v_removed int := 0;
begin
  if not public.has_role('chef') then return public._fail('FORBIDDEN', 'Réservé à la cuisine.'); end if;
  if extract(isodow from p_week_start) <> 1 then return public._fail('BAD_WEEK', 'La semaine doit commencer un lundi.'); end if;
  select id, status into v_menu, v_status from menus where week_start = p_week_start;
  if v_menu is null then
    insert into menus (week_start) values (p_week_start) returning id into v_menu;
  elsif v_status <> 'draft' then
    return public._fail('INVALID_STATUS', 'Ce menu n''est plus un brouillon : repassez-le en brouillon pour le modifier.');
  end if;
  if p_replace then
    delete from menu_items where menu_id = v_menu and sold_qty = 0 and served_qty = 0;
    get diagnostics v_removed = row_count;
  end if;
  insert into menu_items (menu_id, service_date, service, dish_id, price, planned_qty)
  select v_menu, (x ->> 'date')::date, (x ->> 'service')::service_kind, d.id, d.base_price,
         least(greatest(coalesce((x ->> 'planned_qty')::int, 20), 0), 500)
    from jsonb_array_elements(p_items) x join dishes d on d.id = (x ->> 'dish_id')::uuid and d.is_active
   where (x ->> 'date')::date between p_week_start and p_week_start + 6
  on conflict (service_date, service, dish_id) do nothing;
  get diagnostics v_n = row_count;
  perform public._audit('apply_menu_proposal', v_menu::text, jsonb_build_object('items', v_n, 'removed', v_removed));
  return jsonb_build_object('ok', true, 'menu_id', v_menu, 'added', v_n, 'removed', v_removed);
end $$;

revoke all on function public.menu_ai_context(date), public.apply_menu_proposal(date, jsonb, boolean) from public, anon;
grant execute on function public.menu_ai_context(date), public.apply_menu_proposal(date, jsonb, boolean) to authenticated;
