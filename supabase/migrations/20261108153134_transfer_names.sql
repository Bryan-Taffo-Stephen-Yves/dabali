-- Historique : nom (et identifiant) de la personne qui a envoyé / reçu un transfert.
alter table public.transactions add column counterpart_name text;

update public.transactions t set counterpart_name = p.full_name || coalesce(' · ' || p.short_code, '')
  from public.profiles p where p.id = t.counterpart_id and t.type in ('transfer_in', 'transfer_out') and t.counterpart_name is null;

create or replace function public.transfer_funds(p_recipient_id uuid, p_amount int, p_pin text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_lim jsonb := public.setting('transfer_limits');
  v_err text;
  v_balance int;
  v_today_sent int;
  v_out public.transactions;
  v_in public.transactions;
  v_sender text;
  v_sender_code text;
  v_recipient text;
begin
  if v_uid is null then return public._fail('AUTH_REQUIRED', 'Connexion requise.'); end if;
  select full_name, short_code into v_sender, v_sender_code from public.profiles where id = v_uid and not is_blocked;
  if not found then return public._fail('ACCOUNT_BLOCKED', 'Votre compte est bloqué.'); end if;
  if p_recipient_id = v_uid then return public._fail('SELF_TRANSFER', 'Impossible de vous envoyer de l''argent.'); end if;
  select full_name || coalesce(' · ' || short_code, '') into v_recipient from public.profiles where id = p_recipient_id and not is_blocked;
  if v_recipient is null then
    return public._fail('RECIPIENT_NOT_FOUND', 'Destinataire introuvable.');
  end if;
  if p_amount is null or p_amount < (v_lim ->> 'min')::int then
    return public._fail('AMOUNT_TOO_LOW', 'Montant minimum : ' || public.format_fcfa((v_lim ->> 'min')::int) || '.');
  end if;
  if p_amount > (v_lim ->> 'max')::int then
    return public._fail('AMOUNT_TOO_HIGH', 'Montant maximum par transfert : ' || public.format_fcfa((v_lim ->> 'max')::int) || '.');
  end if;

  v_err := public._check_pin(v_uid, p_pin);
  if v_err is not null then return public._pin_fail(v_err); end if;

  -- Verrouillage des deux portefeuilles dans un ordre fixe (évite les interblocages A→B / B→A)
  perform 1 from public.wallets where user_id in (v_uid, p_recipient_id) order by user_id for update;
  select balance into v_balance from public.wallets where user_id = v_uid;

  select coalesce(-sum(amount), 0) into v_today_sent from public.transactions
   where user_id = v_uid and type = 'transfer_out'
     and created_at >= (public.today_abidjan()::timestamp at time zone 'Africa/Abidjan');
  if v_today_sent + p_amount > (v_lim ->> 'daily_max')::int then
    return public._fail('DAILY_LIMIT', 'Plafond journalier atteint (' || public.format_fcfa((v_lim ->> 'daily_max')::int)
                        || '). Reste aujourd''hui : ' || public.format_fcfa(greatest((v_lim ->> 'daily_max')::int - v_today_sent, 0)) || '.');
  end if;
  if v_balance < p_amount then
    return public._fail('INSUFFICIENT_FUNDS', 'Solde insuffisant.', jsonb_build_object('balance', v_balance));
  end if;

  v_out := public._wallet_move(v_uid, -p_amount, 'transfer_out', p_counterpart => p_recipient_id, p_note => p_note);
  v_in := public._wallet_move(p_recipient_id, p_amount, 'transfer_in', p_counterpart => v_uid, p_note => p_note);
  -- Nom de l'autre personne figé dans l'historique de chacun (les clients ne lisent pas les profils des autres)
  update public.transactions set counterpart_name = v_recipient where id = v_out.id;
  update public.transactions set counterpart_name = v_sender || coalesce(' · ' || v_sender_code, '') where id = v_in.id;
  perform public._notify(p_recipient_id, 'transfer_received', 'Transfert reçu',
    v_sender || ' vous a envoyé ' || public.format_fcfa(p_amount) || '.', jsonb_build_object('from', v_uid));
  return jsonb_build_object('ok', true, 'balance', v_out.balance_after, 'transaction_id', v_out.id);
end $$;
