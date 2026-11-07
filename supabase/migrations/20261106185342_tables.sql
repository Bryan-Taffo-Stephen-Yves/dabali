-- Dabali — tables
-- Montants : entiers en FCFA. Horodatages : timestamptz (affichage Africa/Abidjan).

-- ───────────────────────────── Comptes ─────────────────────────────
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text not null check (length(btrim(full_name)) between 2 and 120),
  phone               text unique check (phone ~ '^\+?[0-9]{8,15}$'),
  short_code          text not null unique check (short_code ~ '^DB-[0-9]{4,6}$'),
  role                public.user_role not null default 'client',
  pin_hash            text,
  pin_failed_attempts int not null default 0,
  pin_locked_until    timestamptz,
  points              int not null default 0 check (points >= 0),
  is_blocked          boolean not null default false,
  notify_free_seats   boolean not null default false,
  created_at          timestamptz not null default now()
);

create table public.wallets (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  balance    int not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- ───────────────────────────── Catalogue ─────────────────────────────
create table public.categories (
  id   serial primary key,
  name text not null unique,
  sort int not null default 0
);

create table public.dishes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category_id int references public.categories (id) on delete set null,
  description text,
  composition text,
  kcal        int check (kcal >= 0),
  weight_g    int check (weight_g >= 0),
  allergens   text[] not null default '{}',
  photo_url   text,
  base_price  int not null check (base_price > 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.extras (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  price     int not null check (price >= 0),
  kind      public.extra_kind not null default 'other',
  is_active boolean not null default true,
  sort      int not null default 0
);

-- ───────────────────────────── Stock ─────────────────────────────
create table public.ingredients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  unit            text not null,                         -- kg, L, pièce…
  stock_qty       numeric(12, 3) not null default 0,
  alert_threshold numeric(12, 3) not null default 0,
  unit_cost       int not null default 0 check (unit_cost >= 0)  -- FCFA / unité (coût du gaspillage)
);

create table public.recipe_lines (
  dish_id         uuid not null references public.dishes (id) on delete cascade,
  ingredient_id   uuid not null references public.ingredients (id) on delete restrict,
  qty_per_portion numeric(12, 4) not null check (qty_per_portion > 0),
  primary key (dish_id, ingredient_id)
);

-- ───────────────────────────── Menus ─────────────────────────────
create table public.menus (
  id           uuid primary key default gen_random_uuid(),
  week_start   date not null unique check (extract(isodow from week_start) = 1),  -- lundi
  status       public.menu_status not null default 'draft',
  submitted_at timestamptz,
  published_at timestamptz,
  created_by   uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now()
);

create table public.menu_items (
  id           uuid primary key default gen_random_uuid(),
  menu_id      uuid not null references public.menus (id) on delete cascade,
  service_date date not null,
  service      public.service_kind not null,
  dish_id      uuid not null references public.dishes (id) on delete restrict,
  price        int not null check (price > 0),
  planned_qty  int check (planned_qty >= 0),            -- null = illimité
  sold_qty     int not null default 0 check (sold_qty >= 0),
  served_qty   int not null default 0 check (served_qty >= 0),
  prepared_qty int check (prepared_qty >= 0),
  is_sold_out  boolean not null default false,          -- rupture déclarée manuellement
  is_full      boolean generated always as (planned_qty is not null and sold_qty >= planned_qty) stored,
  unique (service_date, service, dish_id)
);
create index on public.menu_items (menu_id);

create table public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  type          public.stock_move_type not null,
  qty           numeric(12, 3) not null,               -- in/out/loss : > 0 ; adjust : delta signé
  reason        text,
  menu_item_id  uuid references public.menu_items (id) on delete set null,
  created_by    uuid references public.profiles (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  check ((type = 'adjust' and qty <> 0) or (type <> 'adjust' and qty > 0))
);
create index on public.stock_movements (ingredient_id, created_at desc);

-- ───────────────────────────── Tickets & argent ─────────────────────────────
create table public.tickets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id),        -- bénéficiaire
  buyer_id     uuid not null references public.profiles (id),        -- payeur (≠ user_id si « Offrir un repas »)
  menu_item_id uuid not null references public.menu_items (id),
  dish_id      uuid not null references public.dishes (id),
  extras       jsonb not null default '[]',                          -- [{id, name, kind, price, free}]
  total        int not null check (total >= 0),
  status       public.ticket_status not null default 'valid',
  service_date date not null,
  service      public.service_kind not null,
  valid_from   timestamptz not null,
  valid_until  timestamptz not null,
  qr_nonce     text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  used_at      timestamptz,
  scanned_by   uuid references public.profiles (id),
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  check ((status = 'used') = (used_at is not null))
);
create index on public.tickets (user_id, service_date desc);
create index on public.tickets (buyer_id);
create index on public.tickets (menu_item_id);
create index tickets_valid_until_idx on public.tickets (valid_until) where status = 'valid';

create table public.transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id),
  type           public.tx_type not null,
  amount         int not null,                       -- signé : + crédit, − débit
  balance_after  int not null check (balance_after >= 0),
  counterpart_id uuid references public.profiles (id),
  ticket_id      uuid references public.tickets (id),
  performed_by   uuid references public.profiles (id),
  note           text,
  created_at     timestamptz not null default now(),
  check (
    (type in ('purchase', 'transfer_out') and amount < 0) or
    (type in ('recharge', 'recharge_cash', 'transfer_in', 'refund', 'bonus') and amount > 0)
  )
);
create index on public.transactions (user_id, created_at desc);
create index on public.transactions (type, created_at desc);

create table public.ratings (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null unique references public.tickets (id) on delete cascade,
  user_id    uuid not null references public.profiles (id),
  dish_id    uuid not null references public.dishes (id),
  stars      int not null check (stars between 1 and 5),
  comment    text check (length(comment) <= 500),
  created_at timestamptz not null default now()
);
create index on public.ratings (dish_id, created_at desc);

-- ───────────────────────────── Affluence ─────────────────────────────
create table public.rooms (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  total_tables int not null check (total_tables > 0),
  layout       jsonb not null default '[]'            -- [{id:"T1", x, y, seats}] pour le plan de salle
);

create table public.occupancy_snapshots (
  id              bigserial primary key,
  room_id         uuid not null references public.rooms (id) on delete cascade,
  occupied_tables int not null check (occupied_tables >= 0),
  total_tables    int not null check (total_tables > 0),
  rate            numeric(5, 2) not null check (rate between 0 and 100),   -- %
  people_count    int not null default 0 check (people_count >= 0),
  table_states    jsonb not null default '{}',        -- {"T1": true, "T2": false}
  created_at      timestamptz not null default now()
);
create index on public.occupancy_snapshots (room_id, created_at desc);

-- ───────────────────────────── Divers ─────────────────────────────
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  data       jsonb not null default '{}',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

create table public.audit_log (
  id         bigserial primary key,
  actor_id   uuid references public.profiles (id),
  action     text not null,
  target     text,
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.audit_log (created_at desc);

-- Paramètres par défaut (§6.12)
insert into public.settings (key, value) values
  ('services',              '{"lunch":{"label":"Déjeuner","start":"11:30","end":"14:30"},"dinner":{"label":"Dîner","start":"18:30","end":"21:00"}}'),
  ('service_days',          '[1,2,3,4,5]'),
  ('menu_deadline',         '{"weekday":3,"time":"23:59"}'),   -- mercredi 23h59 de la semaine précédente
  ('cancel_cutoff_minutes', '60'),
  ('presale_days',          '7'),
  ('pin_threshold',         '5000'),
  ('transfer_limits',       '{"min":100,"max":50000,"daily_max":100000}'),
  ('recharge_limits',       '{"min":100,"max":500000}'),
  ('loyalty',               '{"points_per_ticket":1,"reward_points":10}'),
  ('low_balance_threshold', '2000');
