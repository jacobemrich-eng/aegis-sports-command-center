# AEGIS v8 Autopilot Architecture

## Daily scheduler

GitHub Actions is the wake-up clock. It calls the protected `/api/autopilot/tick` endpoint around every 30 minutes during the configured Eastern operating window. Render may sleep between requests; the scheduler wakes it.

## Research cadence

AEGIS does not spend sportsbook-data credits on every scheduler tick.

For each production sport it maintains a server-side board snapshot and chooses between:

1. **Full board refresh** — standard ML/spread/total markets; capped per sport/day.
2. **Public-data recheck** — uses the saved odds snapshot while rebuilding the independent evidence stack.
3. **Targeted price refresh** — refreshes exact markets for priority Core/Secondary/Watch candidates near game time.
4. **MLB deep-market refresh** — F1/F3/F5 style markets only inside the configured deep window and credit cap.

The scheduler interval tightens naturally as the nearest game approaches.

## Source freshness

Every market candidate is given a Data Freshness grade:

- **A** — critical information and market state are adequately verified/current.
- **B** — a non-critical uncertainty remains.
- **C** — meaningful critical uncertainty remains.

A C-grade candidate cannot remain Core/Secondary.

MLB uses explicit guards for probable starters, posted batting orders, bullpen workload and quote age. Other engines degrade when public structured data cannot verify key availability information.

## Market execution bands

Qualified markets publish:

- fair probability / fair price
- current book/price
- Play-To
- Downgrade At
- Pass At

This prevents a previously good thesis from remaining a bet after adverse price movement.

## Tier transitions

Every re-analysis compares the latest exact market key against the previous card. Core / Secondary / Watch / Pass changes are written to the persistent tier history with timestamps and reasons.

## Card locking

Inside the final lock window, a play is automatically locked only when:

- tier is Core or Secondary
- stake is greater than zero
- Data Freshness is not C
- timing is `BET NOW`
- game has not begun

The lock records exact line, book, units, model version and timestamp.

If later verification invalidates the exact market before game time, the original lock is preserved and marked `WITHDRAWN` with the withdrawal reason. History is never rewritten to make the model look better.

## Results / calibration

The audit ledger stores all analyzed markets, not only wins or final-card selections. After final scores are available, AEGIS grades the markets and locked bets from structured score feeds.

Results Lab can therefore evaluate:

- released record
- units / ROI
- probability calibration
- model-version history
- projection vs actual outcomes
- tier performance
- market movement snapshots

Calibration remains observation-only. v8 does not automatically rewrite weights from a small sample.

## Persistent state

Production state is stored in Supabase as a server-owned JSONB state ledger. It includes:

- latest cards
- board snapshots
- all-market audit rows
- immutable locks
- market histories
- tier histories
- alerts
- scheduler usage and run status
- grading status

Local `.data/aegis-state.json` exists only as a development fallback.

## Free-tier quota governor

AEGIS reads sportsbook-provider quota headers and keeps both a local daily/monthly budget and a provider reserve. It prioritizes verification close to game time rather than exhaust credits on repeated low-value refreshes.

If the budget/reserve is exhausted, the system alerts and stops claiming paid odds are fresh.

## Failure model

Operational failures are first-class state. Examples include:

- sportsbook quota probe failure
- sportsbook refresh failure
- persistent database unavailable
- grading failure
- sport-specific research failure

The UI displays these alerts. The design preference is explicit degradation or PASS, never silent false readiness.
