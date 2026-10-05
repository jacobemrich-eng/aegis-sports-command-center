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

-- Operator-approved canonical scan requests. Jobs are short-lived, never public,
-- and contain only a sport/market request plus the resulting canonical card.
create table if not exists public.aegis_scan_jobs (
  id uuid primary key,
  session_id_hash text not null,
  sport text not null,
  markets text not null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes')
);

alter table public.aegis_scan_jobs enable row level security;
revoke all on public.aegis_scan_jobs from anon, authenticated;
grant all on public.aegis_scan_jobs to service_role;
create index if not exists aegis_scan_jobs_session_created_idx
  on public.aegis_scan_jobs(session_id_hash, created_at desc);
create index if not exists aegis_scan_jobs_expiry_idx
  on public.aegis_scan_jobs(expires_at);

-- Atomically enforce a small per-admin scan rate and create the job. The edge
-- worker calls this only after validating the signed admin session and CSRF.
create or replace function public.aegis_create_scan_job(
  p_id uuid,
  p_session_id_hash text,
  p_sport text,
  p_markets text
) returns table(job_id uuid, created_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_session_id_hash, 0));
  delete from public.aegis_scan_jobs as expired_job
    where expired_job.created_at < now() - interval '2 days';
  if (select count(*) from public.aegis_scan_jobs as recent_job
      where recent_job.session_id_hash = p_session_id_hash
        and recent_job.created_at > now() - interval '15 minutes') >= 3 then
    return;
  end if;
  return query
    insert into public.aegis_scan_jobs(id, session_id_hash, sport, markets)
    values (p_id, p_session_id_hash, p_sport, p_markets)
    returning id, aegis_scan_jobs.created_at, aegis_scan_jobs.expires_at;
end;
$$;

revoke all on function public.aegis_create_scan_job(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.aegis_create_scan_job(uuid, text, text, text) to service_role;
