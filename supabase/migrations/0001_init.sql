-- Creative Performance Portal — schema + row level security
-- Money is stored in integer minor units (cents).

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin','strategist','editor')),
  person_name text            -- must match the strategist/editor column in the owners sheet
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  account_timezone text not null default 'Europe/Ljubljana',
  currency text not null default 'EUR',
  target_roas numeric not null default 2.5,
  daily_budget_increase_cap_minor int not null default 5000,
  max_budget_change_pct int not null default 20
);
insert into public.settings (id) values (1) on conflict do nothing;

create table if not exists public.adsets (
  adset_id text primary key,
  name text not null,
  campaign_name text not null default '',
  status text not null,
  daily_budget_minor bigint not null default 0
);

create table if not exists public.creatives (
  ad_id text primary key,
  ad_name text not null,
  adset_id text not null,
  format text not null default 'unknown',
  status text not null
);

create table if not exists public.creative_owners (
  ad_id text primary key,
  strategist text not null default '',
  editor text not null default ''
);

create table if not exists public.meta_insights_daily (
  ad_id text not null,
  date date not null,               -- ad account timezone
  spend_minor bigint not null,
  impressions bigint not null,
  clicks bigint not null,
  meta_purchases int not null,
  meta_purchase_value_minor bigint not null,
  primary key (ad_id, date)
);

create table if not exists public.shopify_orders (
  order_id text primary key,
  created_at timestamptz not null,
  date date not null,               -- converted to ad account timezone
  total_minor bigint not null,
  currency text not null,
  utm_source text,
  attributed_ad_id text
);
create index if not exists shopify_orders_date_idx on public.shopify_orders(date);
create index if not exists shopify_orders_ad_idx on public.shopify_orders(attributed_ad_id);

create table if not exists public.sync_runs (
  id text primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  payload jsonb not null            -- full SyncRun incl. data checks
);

create table if not exists public.agent_reports (
  id text primary key,
  created_at timestamptz not null,
  payload jsonb not null
);

create table if not exists public.agent_actions (
  id text primary key,
  report_id text not null references public.agent_reports(id) on delete cascade,
  status text not null,
  payload jsonb not null
);

create table if not exists public.kv (
  key text primary key,
  value jsonb not null
);

-- ---------- helper functions (security definer avoids RLS recursion) ----------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid()
$$;

create or replace function public.my_person() returns text
language sql stable security definer set search_path = public as $$
  select lower(coalesce(person_name, '')) from public.profiles where user_id = auth.uid()
$$;

create or replace function public.can_see_ad(p_ad_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.my_role() = 'admin' then true
    when p_ad_id is null then false
    when public.my_role() = 'strategist' then exists (
      select 1 from public.creative_owners o where o.ad_id = p_ad_id and lower(o.strategist) = public.my_person() and public.my_person() <> '')
    when public.my_role() = 'editor' then exists (
      select 1 from public.creative_owners o where o.ad_id = p_ad_id and lower(o.editor) = public.my_person() and public.my_person() <> '')
    else false end
$$;

-- ---------- RLS: read policies only; all writes go through the server (service role) ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.adsets enable row level security;
alter table public.creatives enable row level security;
alter table public.creative_owners enable row level security;
alter table public.meta_insights_daily enable row level security;
alter table public.shopify_orders enable row level security;
alter table public.sync_runs enable row level security;
alter table public.agent_reports enable row level security;
alter table public.agent_actions enable row level security;
alter table public.kv enable row level security;  -- no policies: service role only

create policy "own profile" on public.profiles for select using (user_id = auth.uid() or public.my_role() = 'admin');
create policy "settings readable" on public.settings for select using (auth.uid() is not null);
create policy "creatives scoped" on public.creatives for select using (public.can_see_ad(ad_id));
create policy "owners scoped" on public.creative_owners for select using (public.can_see_ad(ad_id));
create policy "insights scoped" on public.meta_insights_daily for select using (public.can_see_ad(ad_id));
create policy "orders scoped" on public.shopify_orders for select using (public.can_see_ad(attributed_ad_id));
create policy "adsets scoped" on public.adsets for select using (
  public.my_role() = 'admin'
  or exists (select 1 from public.creatives c where c.adset_id = adsets.adset_id and public.can_see_ad(c.ad_id))
);
create policy "sync runs readable" on public.sync_runs for select using (auth.uid() is not null);
-- The agent's money decisions are visible to admins and strategists, not editors.
create policy "reports readable" on public.agent_reports for select using (public.my_role() in ('admin','strategist'));
create policy "actions readable" on public.agent_actions for select using (public.my_role() in ('admin','strategist'));
