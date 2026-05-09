-- Pocket Steve schema v3 — adds per-person history.
--
-- A "person" is a root entry (parent_id IS NULL).
-- Re-meeting that same person creates a child entry with parent_id pointing
-- at the root. The library shows only roots; tapping one expands the timeline.
--
-- Run after schema-v2.sql.

alter table public.entries
  add column if not exists parent_id uuid references public.entries(id) on delete cascade;

create index if not exists entries_parent_id_idx on public.entries(parent_id);
create index if not exists entries_user_parent_idx on public.entries(user_id, parent_id);
