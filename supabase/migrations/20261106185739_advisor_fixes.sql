-- Correctifs du linter Supabase
-- 1) Vues en security_invoker : le prénom de l'auteur est copié dans ratings (plus besoin de lire profiles).
alter table public.ratings add column author text;
update public.ratings r set author = split_part(p.full_name, ' ', 1) from public.profiles p where p.id = r.user_id;

create or replace function public.rate_ticket(p_ticket_id uuid, p_stars int, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t public.tickets;
begin
  select * into v_t from public.tickets where id = p_ticket_id and user_id = auth.uid();
  if not found then return public._fail('TICKET_NOT_FOUND', 'Ticket introuvable.'); end if;
  if v_t.status <> 'used' then return public._fail('NOT_USED', 'Vous pourrez noter ce plat après l''avoir mangé.'); end if;
  if p_stars is null or p_stars not between 1 and 5 then return public._fail('INVALID_STARS', 'Note de 1 à 5.'); end if;
  insert into public.ratings (ticket_id, user_id, dish_id, stars, comment, author)
  values (v_t.id, v_t.user_id, v_t.dish_id, p_stars, nullif(btrim(left(p_comment, 500)), ''),
          (select split_part(full_name, ' ', 1) from public.profiles where id = v_t.user_id))
  on conflict (ticket_id) do nothing;
  if not found then return public._fail('ALREADY_RATED', 'Vous avez déjà noté ce repas.'); end if;
  return jsonb_build_object('ok', true);
end $$;

drop view public.dish_reviews;
create view public.dish_reviews with (security_invoker = true) as
  select id, dish_id, stars, comment, created_at, author from public.ratings;
alter view public.dish_stats set (security_invoker = true);
grant select on public.dish_reviews to anon, authenticated;
-- user_id des avis non exposé
revoke select on public.ratings from anon, authenticated;
grant select (id, dish_id, stars, comment, created_at, author) on public.ratings to anon, authenticated;

-- 2) search_path figé
alter function public._fail(text, text, jsonb) set search_path = public, pg_temp;
alter function public.today_abidjan() set search_path = public, pg_temp;
alter function public.format_fcfa(int) set search_path = public, pg_temp;
