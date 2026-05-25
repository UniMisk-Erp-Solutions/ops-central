-- OP Central — starter schema for local Supabase (run in Studio SQL editor)
-- Service: supabase-hws00sks44g8k04k8wccooco

create extension if not exists "pgcrypto";

create table if not exists public.org_settings (
  id uuid primary key default gen_random_uuid(),
  org_name text not null default 'OP Central Demo',
  fiscal_year text not null default '2026',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.org_settings enable row level security;

create policy "org_settings_read_authenticated"
  on public.org_settings for select
  to authenticated
  using (true);

create policy "org_settings_read_anon"
  on public.org_settings for select
  to anon
  using (true);

insert into public.org_settings (org_name, fiscal_year)
select 'OP Central Demo', 'FY26'
where not exists (select 1 from public.org_settings limit 1);

grant usage on schema public to anon, authenticated;
grant select on public.org_settings to anon, authenticated;
