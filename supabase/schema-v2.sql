-- Pocket Steve schema v2 — adds OAuth-connected calendar support.
-- Run after the original schema.sql.

-- =============================================================
-- oauth_tokens: stores access + refresh tokens for connected
-- calendar providers (Microsoft Graph, Google Calendar in future).
-- Tokens are sensitive — RLS denies all reads from authenticated
-- users. Only the service-role client (cron) can read/write.
-- =============================================================
create table if not exists public.oauth_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('microsoft', 'google')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  scope text,
  account_email text,
  account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create index if not exists oauth_tokens_provider_idx on public.oauth_tokens(provider);

alter table public.oauth_tokens enable row level security;
-- No SELECT/INSERT/UPDATE/DELETE policies for authenticated users.
-- Service-role bypasses RLS. Authenticated users see *only*
-- the boolean "is connected" via /api/profile, never the token.

create or replace function public.touch_oauth_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists oauth_tokens_touch on public.oauth_tokens;
create trigger oauth_tokens_touch
  before update on public.oauth_tokens
  for each row execute function public.touch_oauth_updated_at();
