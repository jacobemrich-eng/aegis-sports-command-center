-- AEGIS persistent state table. Run once in Supabase SQL Editor.
create table if not exists public.aegis_state (
  id text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- This table is accessed only from the Render server with the Supabase service-role key.
alter table public.aegis_state enable row level security;
-- No anon/authenticated policies are intentionally created. Service-role bypasses RLS.

create index if not exists aegis_state_updated_at_idx on public.aegis_state(updated_at desc);
