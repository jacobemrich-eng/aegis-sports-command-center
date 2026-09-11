# AEGIS v9.0 Production Baseline

## Identity
- Platform release: **v9.0.0**
- Betting engine: **8.8.0-decision-intelligence**
- Governance: **SB101 AEGIS v1.1 — September Daily-Use Freeze**
- Automatic release sports: **MLB, NCAAF**
- NFL shadow system: research/shadow-only

## Proven reliability
- Scheduler redundancy is active.
- External heartbeat authentication and stale-primary detection are proven.
- True failover was proven end-to-end with the GitHub primary disabled.
- Backup recovery executed a real Autopilot tick and returned Operations to GREEN.
- Canonical Operations status is synchronized with confirmed successful Autopilot activity.
- Supabase statement-timeout hardening is active.
- Persistent memory advances only after cloud persistence succeeds.
- Full AEGIS validation passed before production lock.

## Architecture freeze
Preserve unless replaced by a separately tested migration:
- Render
- Supabase persistent state
- GitHub AEGIS Autopilot
- external heartbeat/recovery
- Operations Guardian
- Final Card / Game Lab / Results / Models
- quota governor
- release-sport gates
- Card Lock and audit trail
- SB101 AEGIS governance

## Next milestone
**v9.1 Data Scale & Provider Independence** will centralize provider access, shared caching, provider failover, and remove the small free-tier daily-credit constraint before public launch.
