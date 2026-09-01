# AEGIS v8 — One-Time Hands-Off Setup

Complete this once. Afterward, GitHub Actions wakes the free Render service and AEGIS automatically handles due MLB/NCAAF research, verification, locks, grading and persistent history.

## 1. Upload this complete v8 repository to GitHub

Use the existing repository:

`jacobemrich-eng/aegis-sports-command-center`

Replace the repository contents with this v8 bundle, preserving the directory structure, including the hidden `.github/workflows/` folder.

Do **not** upload `.env` files or API keys.

Commit to `main` and wait for Render to redeploy.

## 2. Create the free Supabase state database

Create a Supabase project, then open **SQL Editor** and run the complete contents of:

`sql/supabase.sql`

That creates the `public.aegis_state` table and enables Row Level Security. There is intentionally no anonymous browser policy because AEGIS writes through the server only.

Then copy these two values from Supabase:

1. Project URL -> use as `SUPABASE_URL`
2. Server **Secret key** beginning with `sb_secret_` -> use as `SUPABASE_SECRET_KEY`

Do not put the Supabase secret key in frontend code or GitHub source files.

## 3. Set Render environment variables

In Render -> your `aegis-sports-command-center` service -> **Environment**, make sure these exist:

### Secrets

- `ODDS_API_KEY` = your existing The Odds API key
- `CFBD_API_KEY` = your existing CollegeFootballData key
- `AEGIS_ACCESS_PIN` = the PIN you want to use to enter AEGIS
- `AEGIS_SESSION_SECRET` = a long random secret different from the PIN
- `AEGIS_AUTOPILOT_SECRET` = another long random secret
- `SUPABASE_URL` = your Supabase project URL
- `SUPABASE_SECRET_KEY` = your `sb_secret_...` server key

### Normal values

The included `render.yaml` supplies these defaults:

- `AEGIS_AUTOPILOT_ENABLED=true`
- `AEGIS_AUTOPILOT_SPORTS=baseball_mlb,americanfootball_ncaaf`
- `AEGIS_RELEASE_SPORTS=baseball_mlb,americanfootball_ncaaf`
- `AEGIS_TIMEZONE=America/New_York`
- `AEGIS_DAILY_ODDS_CREDIT_BUDGET=18`
- `AEGIS_MONTHLY_ODDS_CREDIT_BUDGET=450`
- `AEGIS_MAX_FULL_ODDS_REFRESHES_PER_SPORT_DAY=2`
- `AEGIS_MAX_TARGETED_REFRESHES_PER_SPORT_DAY=3`
- `AEGIS_AUTOPILOT_DEEP_CREDIT_CAP=3`
- `AEGIS_AUTOPILOT_DEEP_WINDOW_HOURS=4`
- `AEGIS_AUTO_LOCK_MINUTES=30`
- `AEGIS_GRADE_DELAY_HOURS=2`
- `ODDS_QUOTA_RESERVE=35`

If an old variable named `AEGIS_DAILY_ODDS_CALL_BUDGET` or `AEGIS_MONTHLY_ODDS_CALL_BUDGET` still exists, it can be removed after the new `...CREDIT_BUDGET` variables are present.

Save the Render environment and redeploy if Render does not do so automatically.

## 4. Add the GitHub Actions scheduler secret

In GitHub:

**Repository -> Settings -> Secrets and variables -> Actions -> New repository secret**

Name:

`AEGIS_AUTOPILOT_SECRET`

Value:

Use the **exact same value** you set in Render.

The included workflow is:

`.github/workflows/aegis-autopilot.yml`

It wakes AEGIS on an off-minute schedule and uses a DST-aware `America/New_York` guard so the working window stays approximately 7 AM-11 PM Eastern even though GitHub cron itself is UTC.

## 5. Run the scheduler once manually

In GitHub:

**Actions -> AEGIS Autopilot -> Run workflow -> Run workflow**

Wait for the workflow to finish successfully.

This confirms:

- GitHub can wake Render
- the scheduler secret matches
- `/api/autopilot/tick` is armed
- AEGIS can store the resulting state

## 6. Confirm the live AEGIS status

Open:

`https://aegis-sports-command-center.onrender.com/`

Enter your PIN.

The top status should report **AUTOPILOT READY**, not `SETUP / DATA CHECK NEEDED`.

The Daily Operations panel should show all of the following:

- persistent cloud storage
- scheduler endpoint armed
- sportsbook API connected
- provider quota / credit usage
- no persistent-storage warning
- automatic card timestamp after a scheduler run

If it reports `EPHEMERAL`, Supabase is not connected correctly.

## 7. Validate one MLB and one NCAAF card

Before treating v8 as the daily source of truth, perform one manual `VERIFY NOW` for each validated release sport.

For MLB, confirm:

- probable starter integrity
- lineup gate
- bullpen workload
- weather if applicable
- F3/F5 display uses the period projection, not the full-game projection
- Play-To / Downgrade / Pass are visible

For NCAAF, confirm:

- team identity is correct
- explicit FBS/FCS classification is correct
- no impossible cross-class direction is being created from incompatible rating scales
- early-season prior/evidence compression is visible when active

## 8. Normal daily use after setup

You do not need to press Scan every morning.

AEGIS will:

1. discover scheduled MLB/NCAAF boards
2. save sportsbook snapshots
3. build independent projections
4. refresh public evidence between paid-odds updates
5. perform targeted price refreshes near game time
6. promote/demote candidates as gates change
7. publish Play-To / Downgrade / Pass thresholds
8. automatically lock eligible Core/Secondary plays in the final window
9. preserve withdrawals instead of rewriting history
10. grade completed games
11. update the server-side Results Lab
12. surface feed/quota/storage failures as alerts

You can still use `VERIFY NOW` when you want an immediate extra check, but it is no longer required for routine operation.

## Free-tier expectations

The scheduler is deliberately quota-aware. It does not repeatedly buy full sportsbook boards every 30 minutes. AEGIS reuses saved odds for free public-data research between a limited number of full-board and targeted market refreshes.

If the provider quota gets too low, AEGIS protects the configured reserve and displays an alert rather than claiming stale prices are fresh.

The release automation defaults to MLB + NCAAF because automatically refreshing every supported sport on a small free sportsbook-data quota would sacrifice data quality. Other sport engines remain usable for research while they are validated and can later be promoted through environment configuration.

## Done-state checklist

You are fully hands-off for validated release sports when all are true:

- [ ] Render v8 is deployed
- [ ] Supabase table exists
- [ ] Render has `SUPABASE_URL`
- [ ] Render has `SUPABASE_SECRET_KEY`
- [ ] Render has `AEGIS_AUTOPILOT_SECRET`
- [ ] GitHub Actions has the matching `AEGIS_AUTOPILOT_SECRET`
- [ ] `AEGIS_ACCESS_PIN` is enabled
- [ ] manual GitHub workflow run succeeds
- [ ] site says `AUTOPILOT READY`
- [ ] Daily Operations says persistent cloud storage
- [ ] MLB validation card looks correct
- [ ] NCAAF cross-class validation looks correct
