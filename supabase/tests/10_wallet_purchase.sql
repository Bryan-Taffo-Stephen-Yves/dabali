-- Portefeuille, recharge, achat de tickets par type de repas, annulation, fidélité, caisse
begin;
select tests.setup();

-- ── Recharge simulée ──
select tests.login('alice');
select tests.eq((public.simulate_recharge(5000) ->> 'balance')::int, 5000, 'recharge simulée de 5 000');
select tests.code(public.simulate_recharge(50), 'INVALID_AMOUNT', 'recharge < minimum refusée');
select tests.code(public.simulate_recharge(10000000), 'INVALID_AMOUNT', 'recharge > maximum refusée');

-- ── Aucune écriture directe sur l'argent ──
select tests.throws($$update public.wallets set balance = 999999$$, 'client : UPDATE wallets interdit');
select tests.throws($$insert into public.transactions (user_id, type, amount, balance_after)
                      values (auth.uid(), 'recharge', 1000, 1000)$$, 'client : INSERT transactions interdit');
select tests.throws($$insert into public.tickets (user_id, buyer_id, service, total, valid_from, valid_until)
                      values (auth.uid(), auth.uid(), 'lunch', 0, now(), now() + interval '1 day')$$, 'client : INSERT tickets interdit');
select tests.throws($$update public.profiles set points = 100 where id = auth.uid()$$, 'client : modifier ses points interdit');
select tests.throws($$update public.profiles set role = 'admin' where id = auth.uid()$$, 'client : changer son rôle interdit');
select tests.throws($$select public._wallet_move(auth.uid(), 1000, 'bonus')$$, 'client : fonction interne _wallet_move non exécutable');
select tests.throws($$select qr_nonce from public.tickets$$, 'client : qr_nonce illisible');
select tests.throws($$select pin_hash from public.profiles$$, 'client : pin_hash illisible');

-- ── Achat d'un ticket Déjeuner (sans plat) ──
select (public.purchase_tickets('lunch') -> 'ticket_ids' ->> 0) as t1 \gset
select tests.eq((select total from public.tickets where id = :'t1'), 2500, 'ticket Déjeuner = 2 500');
select tests.eq((select balance from public.wallets where user_id = auth.uid()), 2500, 'solde débité (2 500)');
select tests.ok((select dish_id is null and menu_item_id is null and service_date is null from public.tickets where id = :'t1'),
                'ticket générique : aucun plat ni date attachés');
select tests.ok((select valid_until between now() + interval '47 hours' and now() + interval '49 hours' from public.tickets where id = :'t1'),
                'ticket valable 48 h');

select tests.code(public.purchase_tickets('lunch', 2), 'INSUFFICIENT_FUNDS', '2 déjeuners avec 2 500 de solde : refusé');
select tests.eq((select balance from public.wallets where user_id = auth.uid()), 2500, 'solde inchangé après refus');
select tests.code(public.purchase_tickets('lunch', 0), 'INVALID_QUANTITY', 'quantité 0 refusée');
select tests.code(public.purchase_tickets('lunch', 11), 'INVALID_QUANTITY', 'plus de 10 tickets refusé');
select tests.code(public.purchase_tickets('breakfast', 1, array[tests.extra('dessert')]), 'EXTRAS_NOT_ALLOWED', 'supplément au petit-déjeuner refusé');
select tests.code(public.purchase_tickets('lunch', 1, array[tests.extra('crudites'), tests.extra('avocat')]), 'INVALID_EXTRA', 'deux entrées refusées');
select tests.code(public.purchase_tickets('lunch', 1, array[tests.extra('bissap')]), 'INVALID_EXTRA', 'boisson désactivée refusée');
select tests.eq((public.purchase_tickets('breakfast') ->> 'total')::int, 500, 'ticket petit-déjeuner = 500');
select tests.eq((public.purchase_tickets('snack') ->> 'total')::int, 700, 'ticket snack = 700');

-- ── Plusieurs tickets + suppléments, PIN au-delà de 5 000 ──
select public.simulate_recharge(20000);
select tests.code(public.purchase_tickets('lunch', 3, array[tests.extra('crudites'), tests.extra('dessert')]), 'PIN_NOT_SET',
                  '3 déjeuners + entrée + dessert (10 500) : PIN requis');
select tests.ok((public.set_pin('2580') ->> 'ok')::boolean, 'création du PIN');
select tests.code(public.purchase_tickets('lunch', 3, array[tests.extra('crudites'), tests.extra('dessert')], '0000'), 'PIN_INVALID', 'PIN faux refusé');
select public.purchase_tickets('lunch', 3, array[tests.extra('crudites'), tests.extra('dessert')], '2580') as r3 \gset
select tests.eq((:'r3'::jsonb ->> 'total')::int, 10500, '3 × (2 500 + 500 + 500) = 10 500');
select tests.eq(jsonb_array_length(:'r3'::jsonb -> 'ticket_ids'), 3, '3 tickets créés');
select tests.eq((select count(*) from public.tickets where id in (select jsonb_array_elements_text(:'r3'::jsonb -> 'ticket_ids')::uuid)
                  and jsonb_array_length(extras) = 2 and total = 3500)::int, 3, 'chaque ticket porte ses 2 suppléments');
select tests.eq((select note from public.transactions where amount = -10500), '3 × ticket Déjeuner + Salade de crudités + Salade de fruits',
                'une seule transaction lisible pour l''achat groupé');

-- ── Offrir des tickets ──
select tests.code(public.purchase_tickets('lunch', 1, '{}', null, tests.uid('bob')), 'PIN_INVALID', 'offrir sans PIN : refusé');
select (public.purchase_tickets('lunch', 2, '{}', '2580', tests.uid('bob')) -> 'ticket_ids' ->> 0) as t_gift \gset
select tests.eq((select user_id from public.tickets where id = :'t_gift'), tests.uid('bob'), 'tickets offerts : bénéficiaire = bob');
select tests.login('bob');
select tests.eq((select count(*) from public.tickets where user_id = auth.uid() and status = 'valid')::int, 2, 'bob voit ses 2 tickets offerts');
select tests.ok(exists (select 1 from public.notifications where type = 'meal_gift'), 'bob notifié');

-- ── Annulation : remboursement tant que le ticket est valide ──
select tests.login('alice');
select tests.eq((select balance from public.wallets where user_id = auth.uid()), 5800, '(solde avant annulation)');
select tests.eq((public.cancel_ticket(:'t1') ->> 'refunded')::int, 2500, 'annulation : 2 500 remboursés');
select tests.eq((select balance from public.wallets where user_id = auth.uid()), 8300, 'solde recrédité');
select tests.code(public.cancel_ticket(:'t1'), 'NOT_CANCELLABLE', 'double annulation refusée');
select tests.login('bob');
select tests.code(public.cancel_ticket((select id from public.tickets where user_id = tests.uid('alice') and status = 'valid' limit 1)),
                  'TICKET_NOT_FOUND', 'annuler le ticket d''un autre : refusé');

-- ── Fidélité : 10 points = 1 petit-déjeuner offert ──
select tests.login('alice');
select tests.code(public.purchase_tickets('breakfast', 1, '{}', null, null, true), 'REWARD_UNAVAILABLE', 'sans 10 points : refusé');
select tests.logout();
update public.profiles set points = 12 where id = tests.uid('alice');
select tests.login('alice');
select tests.code(public.purchase_tickets('lunch', 1, '{}', null, null, true), 'REWARD_UNAVAILABLE', 'les points n''offrent pas un déjeuner');
select public.purchase_tickets('breakfast', 2, '{}', null, null, true) as rr \gset
select tests.eq((:'rr'::jsonb ->> 'total')::int, 500, '2 petits-déjeuners dont 1 offert = 500');
select tests.eq((select points from public.profiles where id = auth.uid()), 2, '10 points consommés');
select public.cancel_ticket((select id from public.tickets where is_reward and user_id = auth.uid()));
select tests.eq((select points from public.profiles where id = auth.uid()), 12, 'annulation du ticket offert : points rendus');

-- ── Caisse ──
select tests.code(public.credit_wallet(tests.uid('bob'), 5000), 'FORBIDDEN', 'client : crédit caisse interdit');
select tests.eq((select count(*) from public.wallets)::int, 1, 'client : ne voit que son propre portefeuille');
select tests.login('caisse');
select tests.eq((public.credit_wallet(tests.uid('alice'), 5000, 'Espèces') -> 'receipt' ->> 'amount')::int, 5000, 'caissier : crédit espèces + reçu');
select tests.eq((select performed_by from public.transactions where type = 'recharge_cash'), tests.uid('caisse'), 'crédit tracé avec le caissier');

-- ── Compte bloqué ──
select tests.ok((public.set_user_blocked(tests.uid('alice'), true) ->> 'ok')::boolean, 'caissier bloque alice');
select tests.login('alice');
select tests.code(public.purchase_tickets('lunch'), 'ACCOUNT_BLOCKED', 'compte bloqué : achat refusé');
select tests.code(public.simulate_recharge(1000), 'ACCOUNT_BLOCKED', 'compte bloqué : recharge refusée');

select tests.logout();
select tests.check_ledger();
rollback;
