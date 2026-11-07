-- Notifications automatiques de service (§4.10)
begin;
select tests.setup();
select tests.login('alice');
select public.simulate_recharge(10000);
select (public.purchase_ticket(tests.item('attieke_lunch')) ->> 'ticket_id') as t1 \gset
select tests.logout();
select valid_from as vf, valid_until as vu from public.tickets where id = :'t1' \gset

select tests.as_service();
select tests.eq((public.notify_service_events(:'vf'::timestamptz - interval '1 hour') ->> 'ticket_valid')::int, 0, 'avant le service : rien');
select tests.eq((public.notify_service_events(:'vf'::timestamptz + interval '1 minute') ->> 'ticket_valid')::int, 1, 'début du service : « votre repas vous attend »');
select tests.eq((public.notify_service_events(:'vf'::timestamptz + interval '6 minutes') ->> 'ticket_valid')::int, 0, 'pas de doublon au passage suivant du cron');
select tests.eq((public.notify_service_events(:'vu'::timestamptz - interval '20 minutes') ->> 'ticket_expiring')::int, 1, '30 min avant la fin : « expire bientôt »');
select tests.eq((public.notify_service_events(:'vu'::timestamptz - interval '10 minutes') ->> 'ticket_expiring')::int, 0, 'pas de doublon');
select tests.logout();

select tests.login('alice');
select tests.throws($$select public.notify_service_events()$$, 'client : fonction réservée au cron');
select tests.eq((select count(*) from public.notifications where type in ('ticket_valid', 'ticket_expiring'))::int, 2, 'alice voit ses 2 notifications');
select tests.logout();
rollback;
