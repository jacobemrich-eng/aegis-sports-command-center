# NCAAF v0.1 historical data contract

This pipeline evaluates target seasons 2019–2025. It also caches 2018 regular-season
games and coaching assignments strictly to construct priors for the first target
season. Raw responses live under `data/ncaaf_history/raw/` and are content-hashed,
deterministically addressed, and intentionally excluded from Git.

## Source coverage and eligibility

| Source | Observed initial coverage | Classification | Blind use |
| --- | --- | --- | --- |
| Games / schedules / scores | 2018–2025 | `SAFE_WITH_CUTOFF` | Schedule and pregame Elo only; scores are targets after freeze |
| Play-by-play | 2019–2025, every regular-season week | `SAFE_WITH_CUTOFF` | Completed prior games only |
| Drives | 2019–2025, every regular-season week | `SAFE_WITH_CUTOFF` | Completed prior games only |
| Team box statistics | Endpoint verified for 2024 | `SAFE_WITH_CUTOFF` | Not used in v0.1; play/drive aggregates avoid duplicate retrieval |
| Advanced/PPA fields | Present on historical plays where populated | `SAFE_WITH_CUTOFF` | Completed prior games only; missing values remain missing |
| Talent composite | 2019–2025 | `SAFE_PREGAME` | Preseason-static roster/talent prior |
| Returning production | 2019–2025 | `SAFE_PREGAME` | Preseason-static prior |
| Transfer portal | 2021–2025 | `SAFE_WITH_CUTOFF` | Only movements dated before August 1; unavailable for 2019–2020 |
| Coaches | 2018–2025 | `SAFE_PREGAME` | Assignment/continuity only; career totals excluded |
| Pregame Elo on game records | 2019–2025 where populated | `SAFE_PREGAME` | Used as published pregame field |
| Standalone Elo, SP+, SRS, CORE | Historical endpoint exists | `RETROSPECTIVE_ONLY` | Excluded; no point-in-time archive was proven |
| Weather | Historical endpoint documented | `SAFE_WITH_CUTOFF` | Excluded; observed weather is not a proven historical forecast snapshot |
| Betting lines | 2019–2025 | `RETROSPECTIVE_ONLY` | Comparator after blind lock only; never in blind matrix |
| FBS classification / conferences | 2019–2025 | `SAFE_PREGAME` | Classification and cross-class diagnostics |

The initial coverage probe returned records for games, plays, drives, team box
statistics, talent, returning production, portal entries, coaches, lines, FBS teams,
and conferences. No source failure was hidden. A missing feature is represented as
missing and lowers sample/data-quality confidence; it is not invented.

## Cutoff rules

Every derived row records `prediction_cutoff_at`, `kickoff_at`,
`source_max_known_at`, and `leakage_check_passed`. Rolling performance comes only
from games completed before the target kickoff. Static preseason inputs use an
August 1 known-at boundary. The builder hard-rejects a dynamic source whose known-at
time is at or after kickoff.

Final scores and first-half scores are attached only as evaluation targets after
the blind feature object is frozen. Market rows are stored as a separate sibling
object with `blind_feature_eligible=false`; their historical timestamp class is
explicitly recorded as closing/latest with unknown point-in-time provenance.

## Frozen evaluation design

- Development: 2019–2022
- Validation/calibration research: 2023
- Untouched holdout: 2024–2025

The v0.1 engine runs at its committed 20,000 simulations per game with unchanged
weights. Ablation is descriptive and restricted to 2019–2023. No 2024–2025 result
is used for selection, calibration, threshold design, or weighting.

