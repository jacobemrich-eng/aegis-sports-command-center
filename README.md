# AEGIS Sports Command Center v8.7.2 — Autopilot & Daily Operations

AEGIS is a free-tier-first sports research operating system built around the SB101 AEGIS decision framework.

**Version taxonomy:** platform release **v8.7.2**; canonical betting governance **SB101 AEGIS v1.1 — September Daily-Use Freeze**. Platform releases do not silently rewrite historical model versions. v8 turns the existing one-tap research engine into a scheduled, persistent daily workflow for **MLB and NCAAF**, while keeping the other registered sport systems available for research and validation.

## What v8 automates

- Scheduled slate discovery and re-analysis.
- Blind independent projections before sportsbook price is used.
- Market challenger / de-vig consensus comparison.
- Source and quote freshness grading (A / B / C).
- Play-To / Downgrade / Pass price bands.
- Automatic Core / Secondary / Watch / Pass movement as information changes.
- Market-history snapshots and tier-transition history.
- MLB lineup, probable-starter, bullpen workload, weather and period-market checks.
- NCAAF current/prior blending, CFBD mapping, explicit FBS/FCS classification and cross-class integrity guards.
- Automatic official-card locking near game time only when release gates still pass.
- Withdrawal history when a previously locked recommendation loses qualification before the game.
- Automatic final-score grading and server-side Results Lab history.
- Free-tier sportsbook-API credit budgeting and provider-quota reserve protection.
- Operational alerts when a feed, database, scheduler, or quota state is degraded.

The engine deliberately treats **PASS / no qualified bet** as a valid result. It does not manufacture action when evidence is weak.

## Production release status

**Automatic release engines:**

- MLB
- NCAAF

**Research / validation engines currently registered:**

- NFL
- NFL preseason
- WNBA
- KBO
- NPB
- additional specialized systems in the Model Registry

Keeping automatic releases limited to the validated engines is intentional. Expanding a sport to hands-off release should happen only after its data coverage, calibration and grading sample are strong enough.

## Architecture

```text
GitHub Actions scheduler
        |
        v
Render /api/autopilot/tick
        |
        +--> The Odds API (quota-governed sportsbook markets)
        +--> MLB Stats API / ESPN public structured feeds
        +--> CFBD (when configured)
        +--> Open-Meteo
        |
        v
Independent projection -> market challenger -> release gates
        |
        +--> latest card / market history / transitions
        +--> automatic lock / withdrawal tracking
        +--> automatic grading
        |
        v
Supabase persistent state ledger
        |
        v
AEGIS web UI / Results Lab
```

## One-time production setup

Read **[ONE_TIME_SETUP.md](ONE_TIME_SETUP.md)**. After those steps are complete, normal MLB/NCAAF daily operation requires no manual scan.

## Required environment variables

### Required for normal production

- `ODDS_API_KEY`
- `CFBD_API_KEY` — strongly recommended for NCAAF production research
- `AEGIS_ACCESS_PIN`
- `AEGIS_SESSION_SECRET`
- `AEGIS_AUTOPILOT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` — preferred modern server-side Supabase key (`sb_secret_...`)

`SUPABASE_SERVICE_ROLE_KEY` remains supported only as a legacy fallback.

### Main autopilot controls

- `AEGIS_AUTOPILOT_ENABLED=true`
- `AEGIS_AUTOPILOT_SPORTS=baseball_mlb,americanfootball_ncaaf`
- `AEGIS_RELEASE_SPORTS=baseball_mlb,americanfootball_ncaaf`
- `AEGIS_DAILY_ODDS_CREDIT_BUDGET=18`
- `AEGIS_MONTHLY_ODDS_CREDIT_BUDGET=450`
- `AEGIS_MAX_FULL_ODDS_REFRESHES_PER_SPORT_DAY=2`
- `AEGIS_MAX_TARGETED_REFRESHES_PER_SPORT_DAY=3`
- `AEGIS_AUTOPILOT_DEEP_CREDIT_CAP=3`
- `AEGIS_AUTOPILOT_DEEP_WINDOW_HOURS=4`
- `AEGIS_AUTO_LOCK_MINUTES=30`
- `AEGIS_GRADE_DELAY_HOURS=2`
- `ODDS_QUOTA_RESERVE=35`

The legacy `AEGIS_DAILY_ODDS_CALL_BUDGET` and `AEGIS_MONTHLY_ODDS_CALL_BUDGET` names are still accepted for backward compatibility, but the values represent provider **credits**, not HTTP request count.

## Local development

```bash
npm install
npm run check
npm start
```

Open `http://localhost:3000`.

Without Supabase, local development falls back to `.data/aegis-state.json`. Do not use that fallback as production persistence on a free Render instance.

## Validation

Run:

```bash
npm run check
```

The check command syntax-checks the server, engine, persistence layer, autopilot and browser bundle, then runs the regression suite.

Current regression coverage includes:

- strict team identity mapping
- NCAAF FBS/FCS classification integrity
- cross-class projection direction guard
- MLB F1/F3/F5 market parsing and grading
- period-specific card display/audit behavior
- source freshness A/C gates
- execution-band ordering
- local persistence fallback
- modern and legacy Supabase server-key semantics
- production release-sport defaults

## Security notes

- Never commit sportsbook, CFBD, Supabase, PIN, session or autopilot secrets to GitHub.
- Put the same `AEGIS_AUTOPILOT_SECRET` in Render and the GitHub Actions repository secret.
- `SUPABASE_SECRET_KEY` is server-only and must never be placed in browser JavaScript.
- The web UI should be protected with `AEGIS_ACCESS_PIN` before production use.

## Important operating limitation

AEGIS can automate only information its configured data sources expose. It does not pretend an unavailable Hard Rock quote, missing lineup, unresolved injury impact, or exhausted sportsbook-data quota is verified. Those conditions are surfaced as degraded freshness, Watch/Pass status, or an operational alert.

This is a decision-support and research system, not a guarantee of betting outcomes.
