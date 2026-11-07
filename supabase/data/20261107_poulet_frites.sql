-- Ajout du plat « Poulet frites » (très demandé sur le terrain), exécuté une fois sur le projet le 07/11/2026.
-- Idempotent. Photo : Pexels (licence Pexels, usage libre), copiée dans le bucket « dishes ».
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
