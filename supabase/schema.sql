-- Steve v1 schema
-- Run this in Supabase SQL Editor after creating the project.
-- Auth (auth.users) is provided by Supabase out of the box.

-- =============================================================
-- profiles: extra per-user metadata, plus calendar URL for nudges
-- =============================================================
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  calendar_ics_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "users read own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "users upsert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "users update own profile"
  on public.profiles for update
  using (auth.uid() = user_id);

-- =============================================================
-- entries: each captured person/group
-- =============================================================
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  raw text not null,
  headline text,
  summary text,
  where_met text,
  names text[] default '{}',
  kids text[] default '{}',
  pets text[] default '{}',
  traits text[] default '{}',
  next_likely_at timestamptz,                 -- when user expects to see them next, optional
  next_likely_where text,                     -- where (often same as where_met but not always)
  created_at timestamptz not null default now()
);

create index if not exists entries_user_id_idx on public.entries(user_id);
create index if not exists entries_user_where_idx on public.entries(user_id, where_met);

alter table public.entries enable row level security;

create policy "users read own entries"
  on public.entries for select
  using (auth.uid() = user_id);

create policy "users insert own entries"
  on public.entries for insert
  with check (auth.uid() = user_id);

create policy "users update own entries"
  on public.entries for update
  using (auth.uid() = user_id);

create policy "users delete own entries"
  on public.entries for delete
  using (auth.uid() = user_id);

-- =============================================================
-- nudges_sent: dedup table so the cron doesn't spam the same
-- (calendar_event_uid, entry_id) pair more than once.
-- =============================================================
create table if not exists public.nudges_sent (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_event_uid text not null,
  entry_id uuid not null references public.entries(id) on delete cascade,
  event_starts_at timestamptz not null,
  sent_at timestamptz not null default now(),
  unique (user_id, calendar_event_uid, entry_id)
);

create index if not exists nudges_user_event_idx on public.nudges_sent(user_id, event_starts_at);

alter table public.nudges_sent enable row level security;

create policy "users read own nudges"
  on public.nudges_sent for select
  using (auth.uid() = user_id);

-- (Inserts done by the cron via service-role key, bypasses RLS.)

-- =============================================================
-- updated_at trigger for profiles
-- =============================================================
create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();
