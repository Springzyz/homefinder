-- HomeFinder initial schema (single-user; all tables RLS-locked, scraper uses service role)

create table listings (
  id bigint generated always as identity primary key,
  portal text not null check (portal in ('idealista','imovirtual','olx','casasapo','supercasa')),
  portal_id text not null,
  url text not null,
  title text not null,
  price numeric not null,
  area_m2 numeric not null,
  price_per_m2 numeric generated always as (round(price / nullif(area_m2, 0))) stored,
  typology text,
  condition text check (condition in ('new','used','renovate')),
  distrito text not null,
  concelho text not null,
  freguesia text,
  image_url text,
  dedupe_key text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  active boolean not null default true,
  raw jsonb,
  unique (portal, portal_id)
);
create index listings_dedupe_idx on listings (dedupe_key);
create index listings_area_idx on listings (concelho, typology);
create index listings_first_seen_idx on listings (first_seen_at desc);

create table price_history (
  listing_id bigint references listings(id) on delete cascade,
  price numeric not null,
  seen_at timestamptz not null default now()
);

create table listing_scores (
  listing_id bigint primary key references listings(id) on delete cascade,
  benchmark_level text,
  benchmark_ppsqm numeric,
  discount_pct numeric,
  label text check (label in ('steal','great','good','fair','above')),
  low_confidence boolean not null default true,
  computed_at timestamptz not null default now()
);

create table searches (
  id bigint generated always as identity primary key,
  name text not null,
  filters jsonb not null,
  min_label text not null default 'good' check (min_label in ('steal','great','good','fair','above')),
  channels text[] not null default '{email,telegram}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table notifications (
  search_id bigint references searches(id) on delete cascade,
  listing_id bigint references listings(id) on delete cascade,
  channel text not null,
  sent_at timestamptz not null default now(),
  primary key (search_id, listing_id, channel)
);

create table market_stats (
  level text not null check (level in ('freguesia','concelho','distrito')),
  key text not null,
  typology text not null,
  condition text not null default 'any',
  median_ppsqm numeric not null,
  p25_ppsqm numeric,
  n int not null,
  computed_at timestamptz not null default now(),
  primary key (level, key, typology, condition)
);

create table scrape_runs (
  id bigint generated always as identity primary key,
  portal text not null,
  started_at timestamptz not null default now(),
  ok boolean not null,
  listings_found int not null default 0,
  error text
);

create table settings (
  id int primary key default 1 check (id = 1),
  telegram_chat_id text,
  notify_email text,
  thresholds jsonb
);
insert into settings (id) values (1);

-- Lock everything down; the web app reads through an authenticated owner policy.
alter table listings enable row level security;
alter table price_history enable row level security;
alter table listing_scores enable row level security;
alter table searches enable row level security;
alter table notifications enable row level security;
alter table market_stats enable row level security;
alter table scrape_runs enable row level security;
alter table settings enable row level security;

-- Only authenticated users (sign-ups disabled in Supabase; just the owner) can use the app.
do $$
declare t text;
begin
  foreach t in array array['listings','price_history','listing_scores','searches','notifications','market_stats','scrape_runs','settings']
  loop
    execute format('create policy "owner all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
