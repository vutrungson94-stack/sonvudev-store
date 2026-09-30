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
 -- 'refunded' means the money went back to the buyer. It is kept separate from
-- 'cancelled' because cancelling an unpaid order and giving back a paid one are
-- different events, and the revenue report has to tell them apart.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('pending', 'pending_transfer', 'paid', 'payment_failed', 'cancelled', 'refunded'));
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

-- English copy for the storefront language switch. Kept optional: a product with
-- no *_en value simply falls back to the Vietnamese text, so existing rows and
-- new ones work without a backfill.
alter table public.products add column if not exists short_description_en text not null default '';
alter table public.products add column if not exists description_en text not null default '';
alter table public.products add column if not exists features_en jsonb not null default '[]'::jsonb;
-- How the product should read in a search result. Left blank, the page falls
-- back to the product name, which nobody outside this site is searching for.
alter table public.products add column if not exists seo_title text not null default '';
alter table public.products add column if not exists seo_description text not null default '';

-- Order lifecycle. An unpaid order stops being payable at expires_at and is
-- cancelled by the background sweep; a proven payment sets paid_at and bumps
-- paid_count, and the release being handed over records delivered_at.
-- paid_count/paid_amount survive the reset back to a fresh order state, so the
-- revenue record is never lost when an order closes.
alter table public.orders add column if not exists expires_at timestamptz;
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists cancel_reason text;
alter table public.orders add column if not exists delivered_at timestamptz;
alter table public.orders add column if not exists paid_count integer not null default 0;
alter table public.orders add column if not exists paid_amount numeric(12, 2) not null default 0;
-- What actually reached the account, in the provider's currency. For a PayPal
-- order that is USD net of nothing yet, not the VND shelf price, and revenue
-- reporting has to reconcile against a PayPal statement rather than a price tag.
alter table public.orders add column if not exists paid_provider_amount numeric(12, 2) not null default 0;
alter table public.orders add column if not exists paid_provider_currency text;
-- Set once per checkout attempt so a lost response cannot create a duplicate.
alter table public.orders add column if not exists idempotency_key text;
-- What went back out. Kept alongside paid_amount rather than subtracted from
-- it, so the gross figure survives and a report can show collected, refunded
-- and net instead of quietly losing the history of a sale.
alter table public.orders add column if not exists refunded_at timestamptz;
alter table public.orders add column if not exists refund_reason text;
alter table public.orders add column if not exists refunded_count integer not null default 0;
alter table public.orders add column if not exists refunded_amount numeric(12, 2) not null default 0;
alter table public.orders add column if not exists refunded_provider_amount numeric(12, 2) not null default 0;
-- One entry per sent message per order, so retries and the webhook/capture race
-- cannot send a buyer two of the same mail.
alter table public.orders add column if not exists notifications jsonb not null default '{}'::jsonb;

create index if not exists orders_idempotency_key_idx on public.orders(idempotency_key);
-- The sweep only ever asks for rows it could act on.
create index if not exists orders_open_idx on public.orders(status, expires_at);
-- The admin history and the badge poll both order by created_at, and neither
-- index above covers that, so Postgres was sorting the whole table on every
-- request. Descending matters here: the queries only ever read the newest end.
create index if not exists orders_created_at_idx on public.orders(created_at desc);
-- The storefront asks for active products newest first on every page load and
-- on every crawl. One index answers both halves of that instead of filtering and
-- sorting separately.
create index if not exists products_active_idx on public.products(status, created_at desc);

alter table public.products enable row level security;
alter table public.orders enable row level security;

-- Intentionally no public policies. Public product reads can be exposed later
-- with a read-only policy; all writes and order reads stay server-side.
