-- Face ID : autorisation de 2 min à usage unique, recharge protégée, PIN remplaçable
begin;
select tests.setup();
select tests.login('alice');
select public.set_pin('2580');
select tests.ok((public.simulate_recharge(10000) ->> 'ok')::boolean, 'sans Face ID activé : recharge normale');

-- Activation (faite par l'Edge Function après l'enregistrement de la clé)
select tests.as_service();
insert into public.webauthn_credentials (user_id, credential_id, public_key) values (tests.uid('alice'), 'cred-1', 'pk');
update public.profiles set biometric_enabled = true where id = tests.uid('alice');

select tests.login('alice');
select tests.throws($$select public.simulate_recharge(5000)$$, 'Face ID activé : recharge refusée sans confirmation');
select tests.as_service();
update public.profiles set biometric_ok_until = now() + interval '2 minutes' where id = tests.uid('alice');
select tests.login('alice');
select tests.ok((public.simulate_recharge(5000) ->> 'ok')::boolean, 'après Face ID : recharge acceptée');
select tests.throws($$select public.simulate_recharge(5000)$$, 'autorisation à usage unique : 2e recharge refusée');

-- PIN remplacé par Face ID pour un transfert
select tests.code(public.transfer_funds(tests.uid('bob'), 1000, 'BIOMETRIC'), 'BIOMETRIC_REQUIRED', 'BIOMETRIC sans Face ID récent : refusé');
select tests.as_service();
update public.profiles set biometric_ok_until = now() + interval '2 minutes' where id = tests.uid('alice');
select tests.login('alice');
select tests.ok((public.transfer_funds(tests.uid('bob'), 1000, 'BIOMETRIC') ->> 'ok')::boolean, 'transfert confirmé par Face ID');
select tests.ok((public.transfer_funds(tests.uid('bob'), 1000, '2580') ->> 'ok')::boolean, 'le code PIN reste un secours');

-- Autorisation expirée
select tests.as_service();
update public.profiles set biometric_ok_until = now() - interval '1 second' where id = tests.uid('alice');
select tests.login('alice');
select tests.code(public.transfer_funds(tests.uid('bob'), 1000, 'BIOMETRIC'), 'BIOMETRIC_REQUIRED', 'autorisation expirée (2 min) : refusée');

-- Déverrouillage par PIN, et pas avec « BIOMETRIC »
select tests.ok((public.check_my_pin('2580') ->> 'ok')::boolean, 'déverrouillage par PIN');
select tests.code(public.check_my_pin('BIOMETRIC'), 'PIN_INVALID', 'check_my_pin n''accepte pas « BIOMETRIC »');

-- Un agent ne peut pas utiliser l'autorisation Face ID d'un client au comptoir
select tests.as_service();
update public.profiles set biometric_ok_until = now() + interval '2 minutes' where id = tests.uid('alice');
select short_code as code from public.profiles where id = tests.uid('alice') \gset
select tests.login('alice');
select public.purchase_tickets('lunch', 1) as t \gset
select tests.login('agent');
select tests.ok((public.redeem_with_pin(:'code', 'BIOMETRIC', public.today_abidjan(), 'lunch') ->> 'ok') is distinct from 'true',
                'BIOMETRIC refusé au comptoir pour le compte d''un autre');

-- Table des clés : chacun ne voit que les siennes, jamais la clé publique
select tests.login('bob');
select tests.eq((select count(*) from public.webauthn_credentials)::int, 0, 'bob ne voit pas les clés d''alice');
select tests.login('alice');
select tests.throws($$select public_key from public.webauthn_credentials$$, 'clé publique non lisible depuis l''appli');

-- Téléphone perdu : clés supprimées, Face ID désactivé
select public.secure_my_devices();
select tests.as_service();
select tests.eq((select count(*) from public.webauthn_credentials where user_id = tests.uid('alice'))::int, 0, 'téléphone perdu : clés Face ID supprimées');
select tests.ok(not (select biometric_enabled from public.profiles where id = tests.uid('alice')), 'téléphone perdu : Face ID désactivé');
select tests.check_ledger();
rollback;
