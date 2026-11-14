-- Téléphone perdu : désactive à la fois Face ID (clés de l'appareil) et WhatsApp (Jean), en plus des QR, sessions et push.
create or replace function public._secure_account(p_user uuid, p_keep_session uuid default null, p_keep_endpoint text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_tickets int; v_sessions int := 0; v_push int; v_wa int; v_keys int;
begin
  update public.tickets set qr_nonce = encode(extensions.gen_random_bytes(16), 'hex')
   where user_id = p_user and status = 'valid';
  get diagnostics v_tickets = row_count;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1 and ($2::uuid is null or id <> $2)' using p_user, p_keep_session;
    get diagnostics v_sessions = row_count;
  end if;
  delete from public.push_subscriptions where user_id = p_user and (p_keep_endpoint is null or endpoint <> p_keep_endpoint);
  get diagnostics v_push = row_count;
  delete from public.whatsapp_links where user_id = p_user;
  get diagnostics v_wa = row_count;
  update public.order_requests set status = 'cancelled' where user_id = p_user and status = 'pending';
  delete from public.webauthn_credentials where user_id = p_user;
  get diagnostics v_keys = row_count;
  update public.profiles set biometric_enabled = false, biometric_ok_until = null where id = p_user;
  perform public._audit('secure_account', p_user::text,
    jsonb_build_object('tickets', v_tickets, 'sessions', v_sessions, 'push', v_push, 'whatsapp', v_wa, 'biometric_keys', v_keys));
  return jsonb_build_object('tickets', v_tickets, 'sessions', v_sessions);
end $$;
