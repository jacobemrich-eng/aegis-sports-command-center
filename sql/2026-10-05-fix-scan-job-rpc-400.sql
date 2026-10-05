-- Repair the scan job RPC installed in Supabase.
-- The RETURNS TABLE output column `created_at` shadows unqualified table
-- references inside PL/pgSQL. Qualify those references to avoid SQLSTATE 42702.
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

revoke all on function public.aegis_create_scan_job(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.aegis_create_scan_job(uuid, text, text, text)
  to service_role;
