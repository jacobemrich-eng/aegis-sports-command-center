# AEGIS v9.3 Cloudflare Edge Migration — Phase 1

## Target architecture

Phase 1 adds a parallel preview path while leaving the current Render production service intact:

- Cloudflare Workers Static Assets serves the files in `public/`. Wrangler keeps its default asset-first behavior, so matching HTML, CSS, JavaScript, and image requests do not invoke Worker code.
- `cloudflare/worker.mjs` is a thin compatibility API for public reads and administrator status. It reads the existing Supabase `aegis_state` row directly and does not load the betting engine, Autopilot, providers, or Node persistence module.
- Supabase remains the authoritative durable state. Phase 1 does not introduce D1 or KV.
- GitHub Actions runs the existing Node `src/autopilot.js` directly for manual validation. The canonical engine performs all model computation and writes through the existing Supabase store.
- Render remains the production deployment, scheduler target, and rollback path until the edge preview passes every validation gate.

Heavy compute stays in GitHub Actions because the canonical AEGIS engine and provider stack are Node workloads with quota governance, durable-state mutation, and long-running model work. Copying that logic into a Worker would create a second betting engine and risk behavioral drift. The Worker therefore fails explicitly for compute/write routes that have not been migrated.

## Cloudflare configuration and secrets

`wrangler.jsonc` contains only safe defaults. Configure these as Cloudflare Worker secrets before creating a preview:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` — preferred `sb_secret_...` server key
- `SUPABASE_SERVICE_ROLE_KEY` — legacy fallback only; do not set when the preferred key is available
- `AEGIS_ACCESS_PIN`
- `AEGIS_SESSION_SECRET`

Optional safe variables are already defined in `wrangler.jsonc`, including `AEGIS_STATE_ID=main`, time zone, release sports, quota budgets, and the explicit preview/compute modes. Do not place real secrets in `wrangler.jsonc`, `.dev.vars.example`, source control, build logs, or deployment commands.

Modern Supabase secret keys are sent only through the `apikey` header. A legacy service-role JWT is sent through both `apikey` and `Authorization: Bearer ...`, matching `src/store.js`.

## GitHub secrets for direct compute

The manual `.github/workflows/aegis-cloudflare-autopilot.yml` workflow requires:

- `ODDS_API_KEY`
- `CFBD_API_KEY`
- `SPORTSGAMEODDS_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` only as a legacy fallback

The workflow has no schedule in Phase 1, does not call Render, and does not use `BASE_URL`. It runs `scripts/autopilot-direct.js`, which fails unless Supabase persistence is configured, healthy, and confirmed after the canonical Autopilot tick.

## Required Supabase migration

Run `sql/cloudflare_edge_auth.sql` in the Supabase SQL editor before testing administrator login. It creates server-only session and shared login-rate tables plus the transaction-safe fixed-window rate-limit RPC.

The migration enables Row Level Security, revokes access from `public`, `anon`, and `authenticated`, and grants only the server `service_role` the required table/RPC privileges. Never expose these tables through a browser Supabase client.

## Preview deployment procedure

1. Confirm the branch is based on the approved production commit and `npm run check` passes in normal CI.
2. Run `node scripts/build-cloudflare-registry.js --check`.
3. Apply `sql/cloudflare_edge_auth.sql` to the production Supabase project during an approved maintenance step.
4. Configure the five Cloudflare secrets listed above. Use the preferred Supabase secret key when available.
5. Run `npx --yes wrangler@4.36.0 deploy --dry-run` and inspect the bundle and asset manifest. Do not deploy from an unreviewed branch.
6. After approval, deploy only to a Cloudflare preview/`workers.dev` target. Do not connect the production custom domain.
7. Smoke-test static assets, minimal public health, public cards/results, login/session/logout, CSRF rejection, administrator status, and explicit compute-route rejection.
8. Manually run the direct-compute workflow once with a low-risk configured sport. Confirm its compact summary, a new durable `last_success_at`, no `last_error`, and unchanged model/engine identity.

## Production cutover gates

Do not move production traffic or scheduling until all of these are true:

- Static assets are served without Worker invocation for normal file requests.
- CSP and all security headers match the Render posture.
- Supabase session rotation, eight-hour expiry, logout revocation, origin checks, CSRF checks, and shared rate limiting pass live preview tests.
- Public endpoints return only their approved contracts and selective Supabase reads stay within acceptable egress.
- Operations status correctly reports scheduler freshness, persistence, current Autopilot errors, and quota state.
- Unsupported compute endpoints return `edge_compute_not_enabled` and never silently execute alternate logic.
- The manual direct workflow completes against durable Supabase state without a local fallback.
- Provider quota consumption and resulting cards match the existing canonical Node path.
- A separate reviewed phase adds and validates a direct-compute schedule before the Render schedule is retired.
- A rollback drill confirms Render can immediately resume serving all production traffic.

## Rollback

During Phase 1, rollback means removing preview traffic from Cloudflare or disabling the preview Worker. Render continues to host the existing application and remains the only scheduled compute path. No Render environment variable, service setting, workflow, or custom domain is changed by this phase.

If a later cutover fails, restore DNS/routing to Render, disable any future Cloudflare schedule, verify the existing Render health and Autopilot status endpoints, and confirm Supabase state continuity before reopening administrator writes.

## Betting-logic guarantee

Phase 1 does not alter SB101/AEGIS betting logic, model weights, thresholds, projections, governance, release authority, provider routing, bankroll logic, or `engine.VERSION`. The only engine access added here is the build-time registry generator and the direct GitHub runner that invokes the existing canonical Autopilot unchanged.
