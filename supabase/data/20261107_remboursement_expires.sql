-- Données : application rétroactive de la règle « ticket jamais scanné = remboursé » aux tickets expirés de l'historique.
-- Exécuté une fois sur le projet le 07/11/2026. Remboursement daté à l'expiration ; pas de notification (historique).
do $$
declare v_t record; v_tx public.transactions; n int := 0;
begin
  for v_t in select k.* from tickets k
              where k.status = 'expired' and k.total > 0
                and not exists (select 1 from transactions t where t.ticket_id = k.id and t.type = 'refund')
              order by k.valid_until loop
    perform 1 from wallets where user_id = v_t.buyer_id for update;
    v_tx := public._wallet_move(v_t.buyer_id, v_t.total, 'refund', p_ticket => v_t.id,
                                p_note => 'Remboursement automatique · ticket ' || public.service_label(v_t.service) || ' non utilisé');
    update transactions set created_at = v_t.valid_until where id = v_tx.id;
    n := n + 1;
  end loop;
  raise notice '% tickets expirés remboursés', n;
end $$;
