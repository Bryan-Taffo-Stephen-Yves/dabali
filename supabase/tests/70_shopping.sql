-- Fiches de courses automatiques
begin;
select tests.setup();
select id as poisson from public.ingredients where name = 'Poisson' \gset

-- Le stock du poisson passe sous le seuil (10 → 9,8 ; seuil 9,9) : une ligne apparaît sur la fiche ouverte
select tests.as_service();
insert into public.stock_movements (ingredient_id, type, qty, reason) values (:'poisson', 'out', 0.2, 'service');
select tests.eq((select count(*) from public.shopping_lists where status = 'open')::int, 1, 'stock sous le seuil : fiche ouverte créée');
select tests.ok((select qty >= 9.9 from public.shopping_items where ingredient_id = :'poisson'),
  'quantité ≥ seuil + besoins des menus (pas d''achat minuscule)');
select tests.ok((select reason like 'Stock 9.8 kg sous le seuil (9.9)%' from public.shopping_items where ingredient_id = :'poisson'), 'motif lisible (décimales conservées)');

-- Un client ne voit rien et ne peut rien faire
select tests.login('alice');
select tests.eq((select count(*) from public.shopping_items)::int, 0, 'client : fiches invisibles');
select tests.code(public.shopping_add('Frites surgelées', 2, 'paquet'), 'FORBIDDEN', 'client : ajout interdit');

-- La cuisine ajoute un article libre puis attribue la fiche
select tests.login('chef');
select tests.ok((public.shopping_add('Frites surgelées', 2, 'paquet')->>'ok')::boolean, 'chef : ajout libre (frites surgelées)');
select id as list from public.shopping_lists where status = 'open' \gset
select tests.code(public.shopping_assign(:'list', tests.uid('alice')), 'INVALID_USER', 'attribution à un client refusée');
select tests.ok((public.shopping_assign(:'list', tests.uid('agent'), 'Supermarché Cap Sud')->>'ok')::boolean, 'fiche attribuée à l''agent');
select tests.as_service();
select tests.eq((select count(*) from public.notifications where user_id = tests.uid('agent') and type = 'shopping_assigned')::int, 1, 'agent notifié');

-- Un nouveau besoin automatique ne touche pas la fiche partie : il va sur la suivante (et rien n'est commandé en double)
select tests.as_service();
insert into public.stock_movements (ingredient_id, type, qty, reason) values (:'poisson', 'out', 0.2, 'service');
select tests.eq((select count(*) from public.shopping_items si join public.shopping_lists sl on sl.id = si.list_id
                  where sl.status = 'open' and si.ingredient_id = :'poisson')::int, 0, 'poisson déjà en cours d''achat : pas de doublon');

-- Ajout urgent du chef sur la fiche en cours : l'acheteur est prévenu
select tests.login('chef');
select tests.ok((public.shopping_add('Œufs', 30, 'pièce', null, :'list')->>'urgent')::boolean, 'ajout urgent sur la fiche en cours');
select tests.as_service();
select tests.eq((select count(*) from public.notifications where user_id = tests.uid('agent') and type = 'shopping_urgent')::int, 1, 'acheteur prévenu de l''ajout');

-- Un autre agent ne peut pas cocher
select tests.login('agent2');
select tests.code(public.shopping_check((select id from public.shopping_items where list_id = :'list' limit 1), 'bought'), 'FORBIDDEN',
  'autre agent : fiche non modifiable');

-- L'acheteur coche ; terminer exige que tout soit coché
select tests.login('agent');
select tests.code(public.shopping_complete(:'list'), 'ITEMS_LEFT', 'terminer sans tout cocher : refusé');
select public.shopping_check(id, 'bought', 12, 36000) from public.shopping_items where list_id = :'list' and ingredient_id = :'poisson';
select public.shopping_check(id, 'bought', null, 3000) from public.shopping_items where list_id = :'list' and label = 'Œufs';
select public.shopping_check(id, 'missing') from public.shopping_items where list_id = :'list' and label = 'Frites surgelées';
select tests.as_service();
select stock_qty as before from public.ingredients where id = :'poisson' \gset
select tests.login('agent');
select tests.ok((public.shopping_complete(:'list')->>'ok')::boolean, 'courses terminées');
select tests.as_service();
select tests.eq((select stock_qty from public.ingredients where id = :'poisson'), :before + 12, 'stock crédité de la quantité achetée');
select tests.eq((select spent_total from public.shopping_lists where id = :'list'), 39000, 'total dépensé = somme des prix');
select tests.eq((select count(*) from public.shopping_items si join public.shopping_lists sl on sl.id = si.list_id
                  where sl.status = 'open' and si.label = 'Frites surgelées')::int, 1, 'article introuvable reporté sur la fiche suivante');
select tests.login('agent');
select tests.code(public.shopping_complete(:'list'), 'BAD_STATUS', 'fiche terminée : pas de double crédit du stock');
rollback;
