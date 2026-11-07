-- Temps d'attente calculé à partir de la file vue par la caméra
begin;
select tests.eq(public._queue_wait_min(0, 40), 0, 'file vide : pas d''attente');
select tests.eq(public._queue_wait_min(12, 40), 3, '12 personnes, comptoir à 4 / min : 3 min');
select tests.eq(public._queue_wait_min(12, 2), 4, 'peu de scans : rythme par défaut 3 / min → 4 min');
select tests.eq(public._queue_wait_min(7, 10), 7, 'comptoir lent (1 / min) : 7 min');
rollback;
