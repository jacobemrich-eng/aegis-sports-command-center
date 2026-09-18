-- AEGIS v9.3 Cloudflare Edge Phase 1 authentication state.
-- Run once in the Supabase SQL editor before enabling an edge preview.

begin;

create table if not exists public.aegis_admin_sessions (
  session_id_hash text primary key,
  csrf_token text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  constraint aegis_admin_sessions_hash_length check (char_length(session_id_hash) = 64),
  constraint aegis_admin_sessions_csrf_length check (char_length(csrf_token) >= 32)
);

create index if not exists aegis_admin_sessions_expiry_idx
  on public.aegis_admin_sessions (expires_at);

create table if not exists public.aegis_login_rate_limits (
  source_hash text not null,
  window_start timestamptz not null,
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (source_hash, window_start),
  constraint aegis_login_rate_source_hash_length check (char_length(source_hash) = 64),
  constraint aegis_login_rate_attempts_nonnegative check (attempts >= 0)
);

create index if not exists aegis_login_rate_window_idx
  on public.aegis_login_rate_limits (window_start);

alter table public.aegis_admin_sessions enable row level security;
alter table public.aegis_login_rate_limits enable row level security;

revoke all on table public.aegis_admin_sessions from public, anon, authenticated;
revoke all on table public.aegis_login_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.aegis_admin_sessions to service_role;
grant select, insert, update, delete on table public.aegis_login_rate_limits to service_role;

create or replace function public.aegis_edge_consume_login_attempt(
  p_source_hash text,
  p_window_start timestamptz,
  p_max_attempts integer default 8
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_attempts integer;
begin
  if char_length(coalesce(p_source_hash, '')) <> 64
     or p_max_attempts <> 8
     or p_window_start is null then
    raise exception 'invalid login-rate input';
  end if;

  delete from public.aegis_login_rate_limits
   where window_start < now() - interval '30 minutes';

  delete from public.aegis_admin_sessions
   where expires_at < now() - interval '1 day'
      or (revoked_at is not null and revoked_at < now() - interval '1 day');

  insert into public.aegis_login_rate_limits (
    source_hash,
    window_start,
    attempts,
    updated_at
  ) values (
    p_source_hash,
    p_window_start,
    1,
    now()
  )
  on conflict (source_hash, window_start)
  do update set
    attempts = public.aegis_login_rate_limits.attempts + 1,
    updated_at = now()
  returning attempts into current_attempts;

  return current_attempts;
end;
$$;

revoke all on function public.aegis_edge_consume_login_attempt(text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.aegis_edge_consume_login_attempt(text, timestamptz, integer)
  to service_role;

commit;
