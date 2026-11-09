-- Bitmojis : le client choisit son personnage, l'agent le voit au comptoir
begin;
select tests.setup();
select tests.login('alice');
update public.profiles set avatar = 'awa' where id = tests.uid('alice');
select tests.eq((select avatar from public.profiles where id = tests.uid('alice')), 'awa', 'le client choisit son bitmoji');
select tests.throws($$update public.profiles set avatar = '<script>' where id = tests.uid('alice')$$, 'identifiant de bitmoji invalide refusé');
select tests.login('bob');
update public.profiles set avatar = 'koffi' where id = tests.uid('alice');
select tests.as_service();
select tests.eq((select avatar from public.profiles where id = tests.uid('alice')), 'awa', 'impossible de changer le bitmoji d''un autre');
select tests.login('agent');
select tests.eq(public.counter_lookup('Alice', 'lunch') -> 'results' -> 0 ->> 'avatar', 'awa', 'l''agent voit le bitmoji au comptoir');
rollback;
