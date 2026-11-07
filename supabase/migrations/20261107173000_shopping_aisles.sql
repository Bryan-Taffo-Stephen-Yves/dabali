-- Rangement des fiches de courses par rayon (assistant IA) : rayon + conditionnement conseillé par article.
alter table public.shopping_items add column aisle text, add column pack_hint text check (length(pack_hint) <= 120);
alter table public.shopping_lists add column organized_at timestamptz;
