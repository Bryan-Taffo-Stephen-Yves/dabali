-- Menu publié : la notification envoyée aux clients (dans l'appli et en push) ouvre directement le menu.
create or replace function public.publish_menu(p_menu_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.menus;
begin
  if not public.has_role('chef') then return public._fail('FORBIDDEN', 'Réservé au chef ou à l''admin.'); end if;
  select * into v from public.menus where id = p_menu_id for update;
  if not found then return public._fail('MENU_NOT_FOUND', 'Menu introuvable.'); end if;
  if v.status = 'published' then return public._fail('INVALID_STATUS', 'Ce menu est déjà publié.'); end if;
  if now() > public.menu_deadline(v.week_start) and not public.has_role('admin') then
    return public._fail('DEADLINE_PASSED', 'Date limite dépassée : seul l''admin peut publier ce menu.');
  end if;
  if not exists (select 1 from public.menu_items where menu_id = v.id) then
    return public._fail('EMPTY_MENU', 'Le menu est vide.');
  end if;
  update public.menus set status = 'published', published_at = now(), submitted_at = coalesce(submitted_at, now())
   where id = v.id;
  perform public._audit('publish_menu', v.id::text, jsonb_build_object('week_start', v.week_start));
  perform public._notify_roles('{client}', 'menu_published', 'Le menu de la semaine est disponible 🍽️',
    'Découvrez les plats de la semaine du ' || to_char(v.week_start, 'DD/MM') || ' et réservez vos repas.',
    jsonb_build_object('menu_id', v.id, 'href', '/app/menu'));  -- la notification (et le push) ouvre le menu
  return jsonb_build_object('ok', true);
end $$;
