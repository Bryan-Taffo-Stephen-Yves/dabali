-- Fin des courses : tout article ajouté à la main et introuvable est reporté sur la fiche suivante
-- (avant : seulement les articles libres ; un ingrédient du stock ajouté à la main disparaissait).
create or replace function public.shopping_complete(p_list_id uuid, p_spent int default null) returns jsonb
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
      if r.ingredient_id is null or r.source = 'manual' then
        insert into shopping_items (list_id, ingredient_id, label, qty, unit, est_cost, source, reason, added_by)
        values (public._shopping_open(), r.ingredient_id, r.label, r.qty, r.unit, r.est_cost, 'manual', 'Introuvable lors des courses ' || v_code, r.added_by)
        on conflict (list_id, ingredient_id) where ingredient_id is not null do update
          set qty = greatest(shopping_items.qty, excluded.qty), source = 'manual', reason = excluded.reason, updated_at = now();
      end if;
    end if;
  end loop;
  v_spent := coalesce(p_spent, (select sum(paid) from shopping_items where list_id = p_list_id and status = 'bought'));
  update shopping_lists set spent_total = v_spent where id = p_list_id;
  perform public._shopping_refresh();

  perform public._notify_roles('{chef}', 'shopping_done', 'Courses ' || v_code || ' terminées',
    v_bought || ' acheté' || case when v_bought > 1 then 's' else '' end
    || case when v_missing > 0 then ', ' || v_missing || ' introuvable' || case when v_missing > 1 then 's' else '' end else '' end
    || case when v_spent is not null then ' · ' || public.fcfa(v_spent) else '' end, jsonb_build_object('list_id', p_list_id));
  perform public._audit('shopping_complete', p_list_id::text, jsonb_build_object('bought', v_bought, 'missing', v_missing, 'spent', v_spent));
  return jsonb_build_object('ok', true, 'bought', v_bought, 'missing', v_missing, 'spent', v_spent);
end $$;
