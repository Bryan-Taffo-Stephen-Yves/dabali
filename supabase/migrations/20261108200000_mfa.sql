-- Double authentification (TOTP, application Google Authenticator / Authy…) pour les rôles sensibles.
-- Réglable dans Paramètres. Par défaut : Admin et Caisse (ils touchent à l'argent).
-- Appliquée côté BASE : sans le second facteur (jeton « aal2 »), un compte de ces rôles perd ses droits d'équipe,
-- même si quelqu'un contourne l'interface.
insert into public.settings (key, value) values ('mfa_required_roles', '["admin", "caissier"]')
on conflict (key) do nothing;

create or replace function public.mfa_required(p_role public.user_role) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_role::text in (select jsonb_array_elements_text(coalesce(public.setting('mfa_required_roles'), '[]'::jsonb)))
$$;

create or replace function public.has_role(variadic p_roles public.user_role[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select not p.is_blocked and (p.role = 'admin' or p.role = any (p_roles))
            and (not public.mfa_required(p.role) or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
       from public.profiles p where p.id = auth.uid()),
    false)
$$;
grant execute on function public.mfa_required(public.user_role) to authenticated;
