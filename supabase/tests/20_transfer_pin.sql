-- Transferts, PIN, plafonds
begin;
select tests.setup();

select short_code as bob_code from public.profiles where id = tests.uid('bob') \gset
select tests.login('alice');
select public.simulate_recharge(200000);

-- ── Recherche du destinataire ──
select tests.eq(public.lookup_recipient(lower(:'bob_code')) ->> 'full_name',
                'Bob Traoré', 'recherche par identifiant court');
select tests.eq(public.lookup_recipient('05 05 05 05 05') ->> 'full_name', 'Bob Traoré', 'recherche par téléphone local');
select tests.eq(public.lookup_recipient('+225 05 05 05 05 05') ->> 'full_name', 'Bob Traoré', 'recherche par téléphone +225');
select tests.code(public.lookup_recipient('0701020304'), 'SELF', 'recherche de soi-même');
select tests.eq(public.lookup_recipient('DABALI:' || :'bob_code') ->> 'full_name', 'Bob Traoré', 'recherche par QR de profil');
select tests.code(public.lookup_recipient('DB-0000000'), 'NOT_FOUND', 'identifiant inconnu');

-- ── Règles ──
select tests.code(public.transfer_funds(tests.uid('bob'), 1000, '2580'), 'PIN_NOT_SET', 'transfert sans PIN créé');
select public.set_pin('2580');
select tests.code(public.transfer_funds(tests.uid('alice'), 1000, '2580'), 'SELF_TRANSFER', 'transfert vers soi-même');
select tests.code(public.transfer_funds(tests.uid('bob'), 50, '2580'), 'AMOUNT_TOO_LOW', 'transfert < 100');
select tests.code(public.transfer_funds(tests.uid('bob'), 60000, '2580'), 'AMOUNT_TOO_HIGH', 'transfert > 50 000');
select tests.code(public.transfer_funds(gen_random_uuid(), 1000, '2580'), 'RECIPIENT_NOT_FOUND', 'destinataire inconnu');

-- ── PIN faux ×3 → blocage 15 min ──
select tests.eq((public.transfer_funds(tests.uid('bob'), 1000, '0000') ->> 'attempts_left')::int, 2, 'PIN faux n°1 (2 essais restants)');
select tests.code(public.transfer_funds(tests.uid('bob'), 1000, null), 'PIN_INVALID', 'PIN absent n°2');
select tests.code(public.transfer_funds(tests.uid('bob'), 1000, '9999'), 'PIN_LOCKED', 'PIN faux n°3 → bloqué');
select tests.code(public.transfer_funds(tests.uid('bob'), 1000, '2580'), 'PIN_LOCKED', 'bon PIN pendant le blocage : refusé');
select tests.ok((select pin_locked_until from public.profiles where id = auth.uid()) between now() + interval '14 minutes' and now() + interval '16 minutes',
                'blocage de 15 minutes');
select tests.eq((select balance from public.wallets where user_id = auth.uid()), 200000, 'aucun débit pendant les échecs');

select tests.logout();
update public.profiles set pin_locked_until = now() - interval '1 second' where id = tests.uid('alice');
select tests.login('alice');

-- ── Transferts valides + plafond journalier ──
select tests.eq((public.transfer_funds(tests.uid('bob'), 50000, '2580', 'Merci') ->> 'balance')::int, 150000, 'transfert 50 000');
select tests.ok((public.transfer_funds(tests.uid('bob'), 50000, '2580') ->> 'ok')::boolean, 'transfert 50 000 (total jour 100 000)');
select tests.code(public.transfer_funds(tests.uid('bob'), 100, '2580'), 'DAILY_LIMIT', 'plafond journalier 100 000 atteint');

select tests.login('bob');
select tests.eq((select balance from public.wallets where user_id = auth.uid()), 100000, 'bob a reçu 100 000');
select tests.eq((select count(*) from public.transactions where type = 'transfer_in')::int, 2, 'bob : 2 transactions transfer_in');
select tests.ok(exists (select 1 from public.notifications where type = 'transfer_received'), 'bob notifié');
select tests.code(public.transfer_funds(tests.uid('alice'), 200000, '1357'), 'AMOUNT_TOO_HIGH', '(montant trop élevé avant contrôle du solde)');
select public.set_pin('1357');
select public.simulate_recharge(1000);
select tests.logout();
-- bob dépense presque tout pour tester le solde insuffisant
update public.settings set value = '{"min":100,"max":500000,"daily_max":1000000}' where key = 'transfer_limits';
select tests.login('bob');
select tests.code(public.transfer_funds(tests.uid('alice'), 200000, '1357'), 'INSUFFICIENT_FUNDS', 'transfert > solde : refusé');
select tests.eq((select balance from public.wallets where user_id = auth.uid()), 101000, 'solde de bob inchangé');

select tests.logout();
select tests.check_ledger();
rollback;
