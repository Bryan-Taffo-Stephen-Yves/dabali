-- Tickets par type de repas : nouveaux services et suppléments « entrée »
-- (ADD VALUE doit être validé avant d'être utilisé : migration séparée)
alter type public.service_kind add value if not exists 'breakfast' before 'lunch';
alter type public.service_kind add value if not exists 'snack' after 'lunch';
alter type public.extra_kind add value if not exists 'starter' before 'dessert';
