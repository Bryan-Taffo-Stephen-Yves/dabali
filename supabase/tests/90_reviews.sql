-- Avis : demande 30 min après le repas, plaintes, photo, alerte chef, réponse de la cuisine
begin;
select tests.setup();
select public.today_abidjan() + 1 as d \gset

select tests.login('alice');
select public.simulate_recharge(20000);
select (public.purchase_tickets('lunch') -> 'ticket_ids' ->> 0) as t1 \gset
select (public.purchase_tickets('lunch') -> 'ticket_ids' ->> 0) as t2 \gset
select tests.logout();
select qr_nonce as n1 from public.tickets where id = :'t1' \gset
select qr_nonce as n2 from public.tickets where id = :'t2' \gset
select tests.as_service();
select public.redeem_ticket(:'t1', :'n1', tests.uid('agent'), :'d', 'lunch');
select public.redeem_ticket(:'t2', :'n2', tests.uid('agent'), :'d', 'lunch');
select tests.login('agent');
select public.serve_dish(:'t1', tests.item('attieke_lunch'));
select public.serve_dish(:'t2', tests.item('garba_lunch'));

-- Juste après le repas : pas encore de demande
select tests.as_service();
select tests.eq(public.request_reviews(), 0, 'moins de 30 min après le repas : pas de demande d''avis');
select tests.login('alice');
select tests.ok(public.pending_review() = 'null'::jsonb, 'pas d''avis en attente pendant le repas');

-- 31 minutes plus tard
select tests.as_service();
update public.tickets set used_at = now() - interval '31 minutes' where id in (:'t1', :'t2');
select tests.eq(public.request_reviews(), 2, '30 min après : une demande d''avis par repas');
select tests.eq(public.request_reviews(), 0, 'demande envoyée une seule fois');
select tests.ok((select data ->> 'href' from public.notifications where user_id = tests.uid('alice') and type = 'rate_dish' limit 1) like '/app/avis/%',
                'la notification ouvre la page d''avis');
select tests.login('alice');
select tests.ok(public.pending_review() ->> 'ticket_id' in (:'t1', :'t2'), 'l''appli propose l''avis en attente');

-- Avis avec plainte grave et photo
select tests.code(public.rate_ticket(:'t1', 1, null, array['poison']), 'INVALID_COMPLAINT', 'motif inconnu refusé');
select tests.code(public.rate_ticket(:'t1', 1, null, '{}', 'quelquun/x.jpg'), 'INVALID_PHOTO', 'photo hors de son dossier refusée');
select tests.ok((public.rate_ticket(:'t1', 1, 'Il y avait une arête dans le riz', array['corps_etranger', 'froid'],
                 tests.uid('alice') || '/t1.jpg') ->> 'alert')::boolean, 'avis grave enregistré avec photo');
select tests.as_service();
select tests.eq((select count(*) from public.notifications where user_id = tests.uid('chef') and type = 'review_alert')::int, 1,
                'chef alerté immédiatement (corps étranger)');
select tests.login('alice');
select tests.ok(public.pending_review() ->> 'ticket_id' = :'t2', 'après un avis : le repas suivant est proposé');
select tests.ok((public.dismiss_review(:'t2') ->> 'ok')::boolean, '« Ne pas noter » enregistré');
select tests.ok(public.pending_review() = 'null'::jsonb, 'plus rien à noter');

-- Vie privée : photo et plaintes ne sont pas lisibles directement
select tests.throws($$select photo_path from public.ratings$$, 'photo d''avis non lisible en direct');
select tests.throws($$select complaints from public.ratings$$, 'plaintes non lisibles en direct');

-- Réponse de la cuisine
select tests.login('chef');
select (public.admin_ratings() -> 'recent' -> 0 ->> 'id') as rid \gset
select tests.ok((public.admin_ratings() -> 'complaints') @> '[{"code": "corps_etranger"}]', 'tableau des plaintes pour le chef');
select tests.ok((public.reply_review(:'rid', 'Désolés, nous avons revu le tri du poisson. Votre prochain repas est offert.') ->> 'ok')::boolean, 'le chef répond');
select tests.login('alice');
select tests.ok(public.my_review(:'t1') ->> 'reply' like 'Désolés%', 'le client voit la réponse');
select tests.as_service();
select tests.ok(exists (select 1 from public.notifications where user_id = tests.uid('alice') and type = 'review_reply'), 'client prévenu de la réponse');
select tests.login('alice');
select tests.code(public.reply_review(:'rid', 'x'), 'FORBIDDEN', 'un client ne peut pas répondre');
rollback;
