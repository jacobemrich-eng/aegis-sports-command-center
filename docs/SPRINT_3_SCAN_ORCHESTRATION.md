# Sprint 3: Canonical Scan Orchestration

## Safety contract

- Cloudflare remains orchestration-only; it does not import or execute the engine, Autopilot, provider router, or store.
- A scan starts only from the authenticated operator Scan Desk after the existing review dialog is explicitly confirmed.
- The browser submits only a sport and one of the bounded market sets. GitHub Actions independently retrieves current odds and calls the existing `engine.scanSlate` implementation.
- Only `baseball_mlb` and `americanfootball_ncaaf` are enabled in the initial runner, matching the current direct-compute allowlist. Other sports are rejected, not simulated.
- A maximum of three jobs per admin session per 15 minutes may be queued. Jobs expire after 30 minutes; completed results are tied to the creating admin session.
- Ask AEGIS remains read-only. It can tell the operator a fresh scan is required, but it does not start a paid scan.
- The feature flag is false in both Wrangler production and preview configuration. No production deployment is authorized by this change.

## Required setup before a Preview scan can run

1. Apply the `aegis_scan_jobs` table and `aegis_create_scan_job` function from `sql/supabase.sql` in the AEGIS Supabase project. The migration is idempotent and denies `anon`/`authenticated` access; only the service role is granted access.
2. Confirm the existing GitHub Actions repository secrets used by the direct Autopilot workflow are present: odds-provider credentials and Supabase URL/service credential. Do not copy or print their values.
3. Create a short-lived fine-grained GitHub token restricted to `jacobemrich-eng/aegis-sports-command-center` with only repository **Actions: read and write**, then store it as the Cloudflare Preview secret `AEGIS_GITHUB_ACTIONS_TOKEN`. GitHub documents this permission for the workflow-dispatch endpoint: [REST API: Create a workflow dispatch event](https://docs.github.com/en/rest/actions/workflows).
4. In the named Cloudflare Preview only, set `AEGIS_SCAN_ORCHESTRATION_ENABLED=true` and `AEGIS_SCAN_WORKFLOW_REF=review/v9-6-scan-desk`. Keep the production flag false. The workflow ref must contain `.github/workflows/aegis-scan-job.yml`.
5. Test only through the authenticated Preview Scan Desk, using one of the two enabled sports. This consumes provider capacity. Tests in this repository mock external services and never run an actual scan or call OpenAI.

If any prerequisite is missing, the Worker fails closed and reports that orchestration is unavailable. Do not compensate by enabling the production flag or deploying production.

## Job lifecycle

`review confirmation → authenticated Worker → rate-limited Supabase job → fixed GitHub workflow dispatch → atomic queued-to-running claim → fresh provider lookup + canonical Node scan → existing AEGIS state persistence → session-scoped result polling`

The only workflow input is an opaque UUID. The worker pins the repository and workflow endpoint; the request cannot choose a workflow, ref, arbitrary events, engine parameters, or result. The runner atomically claims queued work so duplicate workflow deliveries cannot start a second scan.
