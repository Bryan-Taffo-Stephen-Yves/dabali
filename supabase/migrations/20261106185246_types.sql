-- Dabali — extensions et types énumérés
create extension if not exists pgcrypto with schema extensions;

create type public.user_role       as enum ('client', 'agent', 'caissier', 'chef', 'admin');
create type public.tx_type         as enum ('recharge', 'recharge_cash', 'purchase', 'transfer_in', 'transfer_out', 'refund', 'bonus');
create type public.extra_kind      as enum ('dessert', 'drink', 'other');
create type public.stock_move_type as enum ('in', 'out', 'loss', 'adjust');
create type public.menu_status     as enum ('draft', 'submitted', 'published');
create type public.service_kind    as enum ('lunch', 'dinner');
create type public.ticket_status   as enum ('valid', 'used', 'expired', 'cancelled');
