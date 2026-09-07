# NFL shadow staging deployment and first-slate runbook

This staging service is research-only. It uses the same Node application but a separate Render service, a separate `AEGIS_STATE_ID`, disabled Autopilot, no release sports, and permanent challenger release guards. It does not require a SQL migration.

## 1. Create the Render service

1. Push `feat/nfl-integration` and confirm its checks pass.
2. In Render, choose **New > Blueprint** and connect `jacobemrich-eng/aegis-sports-command-center`.
3. Select branch `feat/nfl-integration`.
4. Set **Blueprint Path** to `render-nfl-shadow-staging.yaml` (not `render.yaml`).
5. Review the proposed service. It must create `aegis-nfl-shadow-staging`; it must not update the production service.
6. Supply the secret values below and deploy the Blueprint.
7. Confirm the Render service's linked branch is `feat/nfl-integration` and its public hostname contains `nfl-shadow-staging`.

The Blueprint fixes these non-secret values:

| Render variable | Required value |
| --- | --- |
| `NODE_ENV` | `production` |
| `AEGIS_DEPLOYMENT_ENV` | `nfl-shadow-staging` |
| `AEGIS_STATE_ID` | `nfl-shadow-staging` |
| `AEGIS_AUTOPILOT_ENABLED` | `false` |
| `AEGIS_AUTOPILOT_SPORTS` | `none` |
| `AEGIS_RELEASE_SPORTS` | `none` |
| `NFL_SIM_ENABLED` | `true` |
| `NFL_SIM_SHADOW_ONLY` | `true` |
| `NCAAF_SIM_ENABLED` | `false` |
| `NCAAF_SIM_SHADOW_ONLY` | `true` |
| `MLB_SIM_ENABLED` | `false` |
| `MLB_SIM_SHADOW_ONLY` | `true` |
| `AEGIS_NEW_ENGINE_AUTO_RELEASE` | `false` |

Set these Render secrets without printing their values:

| Render secret | Requirement |
| --- | --- |
| `AEGIS_SHADOW_INGEST_SECRET` | A new staging-only high-entropy value; never reuse the production secret. |
| `SUPABASE_URL` | The Supabase project URL. The same project is acceptable because writes use the separate `nfl-shadow-staging` state row. |
| `SUPABASE_SECRET_KEY` | Supabase server-side secret/service-role key. |
| `AEGIS_ACCESS_PIN` | Strongly recommended to keep the staging dashboard private. |
| `AEGIS_SESSION_SECRET` | Required when using the access PIN; use a new staging-only high-entropy value. |

Do not configure odds keys, Autopilot secrets, heartbeat secrets, or release credentials on this web service. The GitHub runner captures public/model inputs and odds; the staging web service only authenticates, persists, displays, and grades shadow records.

After deployment, open `https://aegis-nfl-shadow-staging.onrender.com/api/health` and confirm:

- `environment` and `state_id` are both `nfl-shadow-staging`;
- `shadow_only` is `true`;
- `production_release_allowed` is `false`;
- `autopilot_enabled` is `false`;
- `persistent_storage` and `storage_ok` are `true`.

The process refuses to start if a service identifying itself as `nfl-shadow-staging` uses `main`, enables Autopilot/auto-release, disables NFL shadow mode, or activates an official release sport.

## 2. Configure the GitHub Actions environment

In GitHub, create an Actions environment named `nfl-shadow-staging`. Put the following settings on that environment so they cannot be confused with production repository secrets:

Secrets:

- `ODDS_API_KEY`: The Odds API key used only after blind snapshots are written.
- `AEGIS_SHADOW_INGEST_SECRET`: Exactly the staging-only value set on the Render staging service.

Variables:

- `AEGIS_SHADOW_ENDPOINT`: `https://aegis-nfl-shadow-staging.onrender.com/api/shadow/games`
- `NFL_SHADOW_SCHEDULED_PUBLISH`: `false` until manual evidence collection is verified.
- `AEGIS_NFL_SHADOW_ALLOWED_HOST`: leave unset for the suggested Render hostname. Set it only when using an intentionally reviewed custom staging hostname.

The publish workflow fails before model/data work when its endpoint or ingest secret is missing. The publisher rejects `aegis-sports-command-center.onrender.com` even if it is accidentally configured. Dry-run publisher validation does not require an endpoint or ingest secret.

## 3. Readiness check

The workflow calls the authenticated, non-mutating `GET /api/shadow/readiness` endpoint before any publish. To check it from a trusted local shell without putting the secret in command history, set the three environment variables in the shell and run:

```powershell
python modeling/nfl/aegis_nfl_staging_readiness.py
```

It verifies HTTPS/host safety, bearer authentication, endpoint availability, exact staging identity, state isolation, simulator flags, disabled Autopilot/auto-release, healthy persistent Supabase storage, and ingestion/grading route availability. It writes no probe record.

## 4. First 2026 NFL shadow slate

The intended workflow dispatch is **NFL 2026 Shadow Validation** with branch `feat/nfl-integration`, `mode=all`, and `publish=true`. The run will validate staging, write all immutable blind v1.0 projections first, capture market snapshots afterward, apply the v0.9 Market Challenger/firewall, publish only `SHADOW_ONLY` records, grade only settled records, and retain artifacts/errors.

GitHub requires a `workflow_dispatch` workflow definition to exist on the repository's default branch before GitHub will accept a manual dispatch. This workflow currently exists only on `feat/nfl-integration`, because this work deliberately does not modify or merge `main`. Therefore the Actions UI/CLI dispatch is not available yet. Do not work around that restriction by targeting production or enabling scheduled publishing.

Until a separately approved workflow-only registration lands on the default branch, run the identical pipeline from a trusted local checkout or Codespace of `feat/nfl-integration`:

```powershell
$env:ODDS_API_KEY = Read-Host "ODDS_API_KEY"
$env:AEGIS_SHADOW_INGEST_SECRET = Read-Host "AEGIS_SHADOW_INGEST_SECRET"
$env:AEGIS_SHADOW_ENDPOINT = "https://aegis-nfl-shadow-staging.onrender.com/api/shadow/games"
python modeling/nfl/aegis_nfl_staging_readiness.py
python modeling/nfl/aegis_nfl_live_pipeline.py --season 2026 --lookahead-days 10 --mode all --publish
```

Use environment injection or a secure secret manager in preference to interactive plain-text input where available. Never add secret values to command arguments, repository files, artifacts, or logs.

Before publishing, a dry run can be performed without the staging endpoint:

```powershell
python modeling/nfl/aegis_nfl_live_pipeline.py --season 2026 --lookahead-days 10 --mode all
```

The live pipeline still needs its public data dependencies and `ODDS_API_KEY` when it reaches market capture. A failed game is isolated; a failed readiness check, data/model phase, market capture, publish, or grading operation cannot create an official pick or alter official bankroll/results/cards.
