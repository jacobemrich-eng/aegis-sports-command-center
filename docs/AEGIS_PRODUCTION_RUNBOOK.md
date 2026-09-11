# AEGIS Production Runbook

## Normal state
- Operations Guardian GREEN during the operating window unless quota protection is legitimately active.
- Schedulers REDUNDANT.
- Persistence CONFIRMED.
- Last Success and Last Successful Run track the same recent successful Autopilot activity.

## Primary scheduler failure
1. Do not press Verify Now during a failover investigation.
2. Leave Render, Supabase, and the external heartbeat enabled.
3. The external heartbeat detects a stale GitHub primary and executes the canonical Autopilot tick.
4. Pass condition: Last Successful Run refreshes while GitHub Autopilot is unavailable.
5. Restore GitHub Autopilot after confirming recovery.

## Persistence timeout
PostgreSQL `57014` means a write exceeded the statement timeout.
- Retry transient failures.
- Reduce only dense market-history retention on timeout retry.
- Never silently switch production persistence to ephemeral local state.

## Quota protection
The current free-tier governor intentionally pauses nonessential sportsbook refreshes when the daily budget is exhausted.
This is expected protection, not a production outage.
Public launch scaling is handled in v9.1.

## Security
- Autopilot and heartbeat endpoints remain bearer-secret protected.
- PIN/session/provider/Supabase secrets remain server-side.
- Never put server secrets in browser-delivered assets.

## Production workflows
- `aegis-autopilot.yml` — primary production scheduler
- `nfl-shadow-scheduler.yml` — NFL shadow/research scheduler
- `aegis-production-ci.yml` — permanent validation gate
