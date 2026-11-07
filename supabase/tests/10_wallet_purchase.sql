-- Portefeuille, recharge, achat, annulation, rupture, fidélité
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
select tests.throws($$insert into public.tickets (user_id, buyer_id, menu_item_id, dish_id, total, service_date, service, valid_from, valid_until)
                      select auth.uid(), auth.uid(), id, dish_id, 0, service_date, service, now(), now() + interval '1 day'
                        from public.menu_items limit 1$$, 'client : INSERT tickets interdit');
select tests.throws($$update public.profiles set points = 100 where id = auth.uid()$$, 'client : modifier ses points interdit');
select tests.throws($$update public.profiles set role = 'admin' where id = auth.uid()$$, 'client : changer son rôle interdit');
select tests.throws($$select public._wallet_move(auth.uid(), 1000, 'bonus')$$, 'client : fonction interne _wallet_move non exécutable');
select tests.throws($$select qr_nonce from public.tickets$$, 'client : qr_nonce illisible');
select tests.throws($$select pin_hash from public.profiles$$, 'client : pin_hash illisible');

-- ── Achat ──
select (public.purchase_ticket(tests.item('attieke_lunch'), array[tests.extra('dessert')]) ->> 'ticket_id') as t_attieke \gset
select tests.eq((select total from public.tickets where id = :'t_attieke'), 3000, 'achat attiéké + dessert = 3 000');
select tests.eq((select balance from public.wallets where user_id = auth.uid()), 2000, 'solde débité (2 000)');
select tests.eq((select status from public.tickets where id = :'t_attieke')::text, 'valid', 'ticket créé au statut valide');
select tests.eq((select sold_qty from public.menu_items where id = tests.item('attieke_lunch')), 1, 'sold_qty incrémenté');
select tests.eq((select valid_until from public.tickets where id = :'t_attieke'),
                (select ends_at from public.service_window(public.today_abidjan() + 1, 'lunch')),
                'valid_until = fin du service (14h30 Abidjan)');

select tests.code(public.purchase_ticket(tests.item('attieke_lunch')), 'INSUFFICIENT_FUNDS', 'solde insuffisant refusé');
select tests.eq((select balance from public.wallets where user_id = auth.uid()), 2000, 'solde inchangé après refus');
select tests.code(public.purchase_ticket(tests.item('garba_lunch'), array[gen_random_uuid()]), 'INVALID_EXTRA', 'option inconnue refusée');
select tests.code(public.purchase_ticket(gen_random_uuid()), 'ITEM_NOT_FOUND', 'plat inconnu refusé');
select tests.ok((public.purchase_ticket(tests.item('garba_lunch')) ->> 'ok')::boolean, 'achat garba 1 500');
select tests.eq((select balance from public.wallets where user_id = auth.uid()), 500, 'solde = 500');

-- ── Rupture automatique (planned_qty = 2) ──
select tests.login('bob');
select public.simulate_recharge(20000);
select tests.ok((public.purchase_ticket(tests.item('attieke_lunch')) ->> 'ok')::boolean, 'bob achète la dernière portion');
select tests.ok((select is_full from public.menu_items where id = tests.item('attieke_lunch')), 'plat plein (sold_qty = planned_qty)');
select tests.code(public.purchase_ticket(tests.item('attieke_lunch')), 'SOLD_OUT', 'plus de portion : SOLD_OUT');

-- ── Rupture manuelle par le chef ──
select tests.login('alice');
update public.menu_items set is_sold_out = true where id = tests.item('garba_lunch');   -- RLS : 0 ligne
select tests.ok(not (select is_sold_out from public.menu_items where id = tests.item('garba_lunch')), 'client : ne peut pas déclarer une rupture');
select tests.login('chef');
update public.menu_items set is_sold_out = true where id = tests.item('garba_lunch');
select tests.login('bob');
select tests.code(public.purchase_ticket(tests.item('garba_lunch')), 'SOLD_OUT', 'plat marqué épuisé : SOLD_OUT');

-- ── Annulation ──
select tests.login('alice');
select tests.eq((public.cancel_ticket(:'t_attieke') ->> 'refunded')::int, 3000, 'annulation : remboursement intégral');
select tests.eq((select balance from public.wallets where user_id = auth.uid()), 3500, 'solde recrédité (3 500)');
select tests.eq((select status from public.tickets where id = :'t_attieke')::text, 'cancelled', 'ticket annulé');
select tests.eq((select sold_qty from public.menu_items where id = tests.item('attieke_lunch')), 1, 'sold_qty décrémenté');
select tests.code(public.cancel_ticket(:'t_attieke'), 'NOT_CANCELLABLE', 'double annulation refusée');
select tests.login('bob');
select tests.code(public.cancel_ticket(:'t_attieke'), 'TICKET_NOT_FOUND', 'annuler le ticket d''un autre : refusé');

-- ── PIN au-delà de 5 000 FCFA ──
select tests.login('alice');
select public.simulate_recharge(10000);
select tests.code(public.purchase_ticket(tests.item('vip_dinner')), 'PIN_NOT_SET', 'achat > 5 000 sans PIN créé');
select tests.code(public.set_pin('1111'), 'PIN_TOO_SIMPLE', 'PIN trop simple refusé');
select tests.code(public.set_pin('12a4'), 'PIN_FORMAT', 'PIN non numérique refusé');
select tests.ok((public.set_pin('2580') ->> 'ok')::boolean, 'création du PIN');
select tests.code(public.set_pin('3691'), 'PIN_INVALID', 'changer de PIN sans l''ancien : refusé');
select tests.code(public.purchase_ticket(tests.item('vip_dinner')), 'PIN_INVALID', 'achat > 5 000 sans PIN : refusé');
select tests.code(public.purchase_ticket(tests.item('vip_dinner'), '{}', '0000'), 'PIN_LOCKED', 'achat > 5 000 PIN faux (3e échec) : bloqué');
select tests.logout();
update public.profiles set pin_locked_until = null where id = tests.uid('alice');
select tests.login('alice');
select tests.ok((public.purchase_ticket(tests.item('vip_dinner'), '{}', '2580') ->> 'ok')::boolean, 'achat > 5 000 avec bon PIN');

-- ── Offrir un repas ──
select tests.code(public.purchase_ticket(tests.item('attieke_dinner'), '{}', null, tests.uid('bob')), 'PIN_INVALID', 'offrir sans PIN : refusé');
select (public.purchase_ticket(tests.item('attieke_dinner'), '{}', '2580', tests.uid('bob')) ->> 'ticket_id') as t_gift \gset
select tests.eq((select user_id from public.tickets where id = :'t_gift'), tests.uid('bob'), 'repas offert : bénéficiaire = bob');
select tests.eq((select buyer_id from public.tickets where id = :'t_gift'), tests.uid('alice'), 'repas offert : payeur = alice');
select tests.login('bob');
select tests.ok(exists (select 1 from public.notifications where type = 'meal_gift'), 'bob notifié du repas offert');
select tests.ok(exists (select 1 from public.tickets where id = :'t_gift'), 'bob voit le ticket offert');

-- ── Fidélité : 10 points = 1 dessert offert ──
select tests.login('alice');
select tests.code(public.purchase_ticket(tests.item('garba_lunch'), array[tests.extra('dessert')], null, null, true),
                  'SOLD_OUT', '(garba épuisé)');
select tests.code(public.purchase_ticket(tests.item('attieke_dinner'), array[tests.extra('dessert')], null, null, true),
                  'REWARD_UNAVAILABLE', 'récompense sans 10 points : refusée');
select tests.logout();
update public.profiles set points = 12 where id = tests.uid('alice');
select tests.login('alice');
select tests.code(public.purchase_ticket(tests.item('attieke_dinner'), array[tests.extra('bissap')], null, null, true),
                  'REWARD_UNAVAILABLE', 'récompense sans dessert choisi : refusée');
select (public.purchase_ticket(tests.item('attieke_dinner'), array[tests.extra('dessert'), tests.extra('bissap')], null, null, true) ->> 'ticket_id') as t_reward \gset
select tests.eq((select total from public.tickets where id = :'t_reward'), 2800, 'dessert offert : 2 500 + bissap 300');
select tests.eq((select points from public.profiles where id = auth.uid()), 2, '10 points consommés');
select public.cancel_ticket(:'t_reward');
select tests.eq((select points from public.profiles where id = auth.uid()), 12, 'annulation : points rendus');

-- ── Caisse ──
select tests.code(public.credit_wallet(tests.uid('bob'), 5000), 'FORBIDDEN', 'client : crédit caisse interdit');
select tests.eq((select count(*) from public.wallets)::int, 1, 'client : ne voit que son propre portefeuille');
select tests.login('caisse');
select tests.eq((public.credit_wallet(tests.uid('alice'), 5000, 'Espèces') -> 'receipt' ->> 'amount')::int, 5000, 'caissier : crédit espèces + reçu');
select tests.eq((select performed_by from public.transactions where type = 'recharge_cash'), tests.uid('caisse'), 'crédit tracé avec le caissier');
select tests.ok((select count(*) from public.wallets) >= 2, 'caissier : voit tous les portefeuilles');

-- ── Compte bloqué ──
select tests.ok((public.set_user_blocked(tests.uid('alice'), true) ->> 'ok')::boolean, 'caissier bloque alice');
select tests.login('alice');
select tests.code(public.purchase_ticket(tests.item('attieke_dinner')), 'ACCOUNT_BLOCKED', 'compte bloqué : achat refusé');
select tests.code(public.simulate_recharge(1000), 'ACCOUNT_BLOCKED', 'compte bloqué : recharge refusée');

select tests.logout();
select tests.check_ledger();
rollback;
