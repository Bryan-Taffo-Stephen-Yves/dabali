-- Double authentification : droits d'équipe seulement avec le second facteur (aal2) pour les rôles concernés
begin;
select tests.setup();

select tests.login('admin', 'aal1');
select tests.ok(not public.has_role('admin'), 'admin sans 2e facteur : pas de droits admin');
select tests.code(public.shopping_refresh(), 'FORBIDDEN', 'admin sans 2e facteur : actions refusées');
select tests.login('admin', 'aal2');
select tests.ok(public.has_role('admin'), 'admin avec 2e facteur : droits admin');

select tests.login('caisse', 'aal1');
select tests.ok(not public.has_role('caissier'), 'caisse sans 2e facteur : bloquée');
select tests.login('chef', 'aal1');
select tests.ok(public.has_role('chef'), 'chef : 2e facteur non exigé par défaut');

-- Réglage : on l'exige aussi pour le chef
select tests.as_service();
update public.settings set value = '["admin", "caissier", "chef"]' where key = 'mfa_required_roles';
select tests.login('chef', 'aal1');
select tests.ok(not public.has_role('chef'), 'réglage étendu au chef : 2e facteur exigé');
rollback;
