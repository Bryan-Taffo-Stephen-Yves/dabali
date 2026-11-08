-- Avis enrichis : demandés 30 min après le repas, avec photo facultative, plaintes en un clic,
-- réponse de la cuisine, alerte immédiate au chef pour un problème grave.

alter table public.ratings
  add column photo_path text check (length(photo_path) <= 200),
  add column complaints text[] not null default '{}',
  add column reply text check (length(reply) <= 500),
  add column replied_at timestamptz,
  add column replied_by uuid references public.profiles (id);
alter table public.ratings add constraint ratings_complaints_valid
  check (complaints <@ array['froid', 'pas_cuit', 'trop_sale', 'fade', 'portion', 'corps_etranger', 'attente', 'autre']::text[]);
-- photo, plaintes et réponse : pas de lecture directe (seulement via les fonctions ci-dessous)

alter table public.tickets add column review_requested_at timestamptz, add column review_dismissed_at timestamptz;
grant select (review_requested_at, review_dismissed_at) on public.tickets to authenticated;

create function public._complaint_label(p text) returns text language sql immutable as $$
  select case p when 'froid' then 'Froid' when 'pas_cuit' then 'Pas assez cuit' when 'trop_sale' then 'Trop salé'
    when 'fade' then 'Fade' when 'portion' then 'Portion trop petite' when 'corps_etranger' then 'Corps étranger'
    when 'attente' then 'Attente trop longue' else 'Autre' end
$$;

-- Photos des avis : dossier = identifiant du client ; lecture publique (URL non devinable)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('reviews', 'reviews', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    execute $p$create policy "reviews photos read" on storage.objects for select to anon, authenticated
                using (bucket_id = 'reviews')$p$;
    execute $p$create policy "reviews photos write" on storage.objects for insert to authenticated
                with check (bucket_id = 'reviews' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end $$;

create or replace function public.serve_dish(p_ticket_id uuid, p_menu_item_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_t public.tickets;
  v_mi record;
begin
  if not public.has_role('agent') then return public._fail('FORBIDDEN', 'Compte agent requis.'); end if;
  select * into v_t from public.tickets where id = p_ticket_id for no key update;
  if not found or v_t.status <> 'used' then return public._fail('TICKET_NOT_FOUND', 'Scannez d''abord le ticket.'); end if;
  if v_t.dish_id is not null then return public._fail('ALREADY_SERVED', 'Plat déjà enregistré pour ce ticket.'); end if;
  if v_t.used_at < now() - interval '30 minutes' then return public._fail('TOO_LATE', 'Ticket scanné il y a plus de 30 minutes.'); end if;

  select mi.*, d.name as dish_name into v_mi
    from public.menu_items mi join public.menus m on m.id = mi.menu_id join public.dishes d on d.id = mi.dish_id
   where mi.id = p_menu_item_id and m.status = 'published'
     and mi.service_date = v_t.service_date and mi.service = v_t.service
     for no key update of mi;
  if not found then return public._fail('WRONG_ITEM', 'Ce plat n''est pas au menu de ce service.'); end if;
  if v_mi.is_sold_out or v_mi.is_full then return public._fail('SOLD_OUT', v_mi.dish_name || ' est épuisé.'); end if;

  update public.tickets set menu_item_id = v_mi.id, dish_id = v_mi.dish_id where id = v_t.id;
  update public.menu_items set sold_qty = sold_qty + 1, served_qty = served_qty + 1 where id = v_mi.id;
  insert into public.stock_movements (ingredient_id, type, qty, reason, menu_item_id, created_by)
  select rl.ingredient_id, 'out', rl.qty_per_portion, 'Portion servie', v_mi.id, v_uid
    from public.recipe_lines rl where rl.dish_id = v_mi.dish_id;
  -- La demande d'avis part 30 min après le repas (request_reviews, cron), plus au moment du service.
  perform public._audit('serve_dish', v_t.id::text, jsonb_build_object('dish', v_mi.dish_name));
  return jsonb_build_object('ok', true, 'dish', v_mi.dish_name,
                            'counters', public.service_counters(v_t.service_date, v_t.service));
end $$;

-- 30 min après le repas : demande d'avis (une seule fois par ticket, repas des dernières 24 h)
create function public.request_reviews() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  with due as (
    update public.tickets t set review_requested_at = now()
     where t.status = 'used' and t.dish_id is not null and t.review_requested_at is null and t.review_dismissed_at is null
       and t.used_at <= now() - interval '30 minutes' and t.used_at > now() - interval '1 day'
       and not exists (select 1 from public.ratings r where r.ticket_id = t.id)
    returning t.id, t.user_id, t.dish_id
  )
  insert into public.notifications (user_id, type, title, body, data)
  select due.user_id, 'rate_dish', 'Comment était ton ' || lower(split_part(d.name, ' ', 1)) || ' ?',
         'Note ton repas (photo facultative) : la cuisine lit tous les avis.',
         jsonb_build_object('ticket_id', due.id, 'dish_id', due.dish_id, 'href', '/app/avis/' || due.id)
    from due join public.dishes d on d.id = due.dish_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- Avis en attente pour le client connecté (ouvre la fenêtre d'avis dans l'appli)
create function public.pending_review() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select jsonb_build_object('ticket_id', t.id, 'dish', d.name, 'photo_url', d.photo_url, 'service', t.service, 'used_at', t.used_at)
      from public.tickets t join public.dishes d on d.id = t.dish_id
     where t.user_id = auth.uid() and t.status = 'used' and t.review_dismissed_at is null
       and t.used_at <= now() - interval '30 minutes' and t.used_at > now() - interval '1 day'
       and not exists (select 1 from public.ratings r where r.ticket_id = t.id)
     order by t.used_at desc limit 1), 'null'::jsonb)
$$;

create function public.dismiss_review(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.tickets set review_dismissed_at = now() where id = p_ticket_id and user_id = auth.uid();
  if not found then return public._fail('TICKET_NOT_FOUND', 'Ticket introuvable.'); end if;
  return jsonb_build_object('ok', true);
end $$;

drop function public.rate_ticket(uuid, int, text);
create function public.rate_ticket(p_ticket_id uuid, p_stars int, p_comment text default null,
                                   p_complaints text[] default '{}', p_photo_path text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t public.tickets; v_dish text; v_client text; v_id uuid; v_grave boolean;
begin
  select * into v_t from public.tickets where id = p_ticket_id and user_id = auth.uid();
  if not found then return public._fail('TICKET_NOT_FOUND', 'Ticket introuvable.'); end if;
  if v_t.status <> 'used' or v_t.dish_id is null then
    return public._fail('NOT_USED', 'Vous pourrez noter ce plat après avoir été servi.');
  end if;
  if p_stars is null or p_stars not between 1 and 5 then return public._fail('INVALID_STARS', 'Note de 1 à 5.'); end if;
  p_complaints := coalesce(p_complaints, '{}');
  if not p_complaints <@ array['froid', 'pas_cuit', 'trop_sale', 'fade', 'portion', 'corps_etranger', 'attente', 'autre']::text[] then
    return public._fail('INVALID_COMPLAINT', 'Motif de plainte inconnu.');
  end if;
  if p_photo_path is not null and p_photo_path not like auth.uid()::text || '/%' then
    return public._fail('INVALID_PHOTO', 'Photo invalide.');
  end if;
  select full_name into v_client from public.profiles where id = v_t.user_id;
  insert into public.ratings (ticket_id, user_id, dish_id, stars, comment, author, complaints, photo_path)
  values (v_t.id, v_t.user_id, v_t.dish_id, p_stars, nullif(btrim(left(p_comment, 500)), ''), split_part(v_client, ' ', 1),
          (select coalesce(array_agg(distinct c), '{}') from unnest(p_complaints) c), p_photo_path)
  on conflict (ticket_id) do nothing
  returning id into v_id;
  if v_id is null then return public._fail('ALREADY_RATED', 'Vous avez déjà noté ce repas.'); end if;

  -- Problème grave (corps étranger) ou très mauvaise note avec plainte : le chef est prévenu tout de suite
  v_grave := 'corps_etranger' = any (p_complaints) or (p_stars <= 2 and cardinality(p_complaints) > 0);
  if v_grave then
    select name into v_dish from public.dishes where id = v_t.dish_id;
    perform public._notify_roles('{chef}', 'review_alert',
      case when 'corps_etranger' = any (p_complaints) then '⚠️ Corps étranger signalé' else 'Avis très négatif' end || ' · ' || v_dish,
      p_stars || '/5 · ' || (select string_agg(public._complaint_label(c), ', ') from unnest(p_complaints) c)
      || coalesce(' · « ' || nullif(btrim(left(p_comment, 120)), '') || ' »', ''),
      jsonb_build_object('rating_id', v_id, 'href', '/admin/avis'));
  end if;
  return jsonb_build_object('ok', true, 'rating_id', v_id, 'alert', v_grave);
end $$;

-- Avis du client sur un ticket (avec la réponse de la cuisine)
create function public.my_review(p_ticket_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select jsonb_build_object('id', r.id, 'stars', r.stars, 'comment', r.comment, 'complaints', r.complaints,
                                             'photo_path', r.photo_path, 'reply', r.reply, 'replied_at', r.replied_at, 'created_at', r.created_at)
                     from public.ratings r where r.ticket_id = p_ticket_id and r.user_id = auth.uid()), 'null'::jsonb)
$$;

create function public.reply_review(p_rating_id uuid, p_reply text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r public.ratings; v_dish text;
begin
  if not public.has_role('chef') then return public._fail('FORBIDDEN', 'Réservé à la cuisine.'); end if;
  if nullif(btrim(p_reply), '') is null then return public._fail('EMPTY', 'Écrivez une réponse.'); end if;
  update public.ratings set reply = btrim(left(p_reply, 500)), replied_at = now(), replied_by = auth.uid()
   where id = p_rating_id returning * into v_r;
  if not found then return public._fail('NOT_FOUND', 'Avis introuvable.'); end if;
  select name into v_dish from public.dishes where id = v_r.dish_id;
  perform public._notify(v_r.user_id, 'review_reply', 'La cuisine a répondu à ton avis',
    v_dish || ' · « ' || left(btrim(p_reply), 120) || ' »', jsonb_build_object('ticket_id', v_r.ticket_id, 'href', '/app/avis/' || v_r.ticket_id));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_ratings() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.has_role('chef') then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'dishes', (select coalesce(jsonb_agg(x order by x.avg_stars nulls last), '[]') from (
                 select d.id, d.name, d.photo_url, round(avg(r.stars)::numeric, 2) avg_stars, count(r.id)::int n,
                        jsonb_build_object('1', count(*) filter (where r.stars = 1), '2', count(*) filter (where r.stars = 2),
                                           '3', count(*) filter (where r.stars = 3), '4', count(*) filter (where r.stars = 4),
                                           '5', count(*) filter (where r.stars = 5)) dist,
                        round(avg(r.stars) filter (where r.created_at > now() - interval '7 days')::numeric, 2) last7,
                        count(*) filter (where cardinality(r.complaints) > 0 and r.created_at > now() - interval '30 days')::int complaints_30d
                   from dishes d left join ratings r on r.dish_id = d.id group by d.id) x),
    'complaints', (select coalesce(jsonb_agg(jsonb_build_object('code', c, 'label', public._complaint_label(c), 'n', n) order by n desc), '[]')
                     from (select unnest(complaints) c, count(*)::int n from ratings
                            where created_at > now() - interval '30 days' group by 1) x),
    'recent', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
                 select r.id, d.name dish, r.stars, r.comment, r.author, r.created_at, r.complaints, r.photo_path, r.reply, r.replied_at,
                        (select array_agg(public._complaint_label(c)) from unnest(r.complaints) c) complaint_labels
                   from ratings r join dishes d on d.id = r.dish_id
                  where r.comment is not null or cardinality(r.complaints) > 0 or r.photo_path is not null
                  order by r.created_at desc limit 40) x));
end $$;

revoke all on function public.request_reviews() from public, anon, authenticated;
grant execute on function public.request_reviews() to service_role;
revoke all on function public.pending_review(), public.dismiss_review(uuid), public.my_review(uuid),
  public.rate_ticket(uuid, int, text, text[], text), public.reply_review(uuid, text) from public, anon;
grant execute on function public.pending_review(), public.dismiss_review(uuid), public.my_review(uuid),
  public.rate_ticket(uuid, int, text, text[], text), public.reply_review(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('dabali-request-reviews', '*/5 * * * *', 'select public.request_reviews()');
  end if;
end $$;
