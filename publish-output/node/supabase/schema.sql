-- SonVuDev store schema for Supabase/Postgres.
-- Run this once in the Supabase SQL editor after creating a project.
-- The server uses the service role key only on the server; never expose it to the browser.

create table if not exists public.products (
  id text primary key default gen_random_uuid()::text,
  slug text not null unique,
  name text not null,
  short_description text not null default '',
  description text not null default '',
  category text not null default 'Khác',
  platform text not null default 'Windows',
  version text not null default '1.0.0',
  price numeric(12, 2) not null default 0,
  currency text not null default 'VND',
  badge text,
  features jsonb not null default '[]'::jsonb,
  requirements text not null default '',
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  file_key text,
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id text primary key,
  order_number text not null unique,
  access_token_hash text not null,
  customer_email text not null,
  customer_name text not null default '',
  status text not null default 'pending' check (status in ('pending', 'pending_transfer', 'paid', 'payment_failed', 'cancelled')),
  payment_provider text not null default 'bank_transfer',
  provider_order_id text,
  amount numeric(12, 2) not null,
  currency text not null default 'VND',
  items jsonb not null default '[]'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_customer_email_idx on public.orders(customer_email);
create index if not exists orders_provider_order_id_idx on public.orders(provider_order_id);
create index if not exists products_status_idx on public.products(status);

alter table public.products enable row level security;
alter table public.orders enable row level security;

-- Intentionally no public policies. Public product reads can be exposed later
-- with a read-only policy; all writes and order reads stay server-side.
