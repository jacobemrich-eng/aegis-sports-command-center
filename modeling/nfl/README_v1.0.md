# SB101 AEGIS NFL v1.0 — Feature Ablation + Coefficient Calibration

v1.0 asks a stricter question than "does this feature sound useful?":

**Does this feature family improve unseen NFL predictions?**

## Leakage / overfitting control

Feature selection and hyperparameter tuning use only:
- 2023
- 2024

The full 2025 season is reserved as the untouched final promotion holdout.

No 2025 result is used to choose:
- feature groups,
- Ridge alpha,
- logistic regularization,
- removal order.

## Feature families audited

- efficiency / success
- QB / passing
- rushing
- drives / finishing
- explosiveness
- pressure / sacks
- turnovers
- pace / pass tendency
- rest / divisional context
- volume / sample support

Every family receives a leave-one-family-out audit.

A family is removed only if its removal improves the development model while staying inside conservative no-regression guards.

## Coefficient calibration

After feature ablation, v1.0 separately tunes:
- margin Ridge alpha
- total Ridge alpha
- ATS logistic C
- over/under logistic C

using development seasons only.

## Promotion

The frozen challenger is then evaluated on untouched 2025.

If it does not materially improve v0.8 without material regression, the v0.8 internal champion remains active.

Production betting remains disabled regardless of the outcome; v1.0 is a shadow-model promotion decision only.

## Current internal shadow Champion

The untouched 2025 gate returned `PROMOTE_V10_INTERNAL_CHALLENGER`.
`NFL_v1.0_FEATURE_ABLATION` is therefore the current internal shadow Champion;
`NFL_v0.8_FEATURE_HYGIENE` remains its historical predecessor. This is an
internal-model promotion only. It does not authorize production betting.

## Publishing a completed live projection

`aegis_nfl_shadow_publisher.py` connects completed v1.0 game projections to
the protected Command Center boundary. It requires separate JSON files and
timestamps so the order is enforceable:

```text
v1.0 blind internal projection
-> independent market capture
-> server-side v0.9 learned market blend
-> disagreement firewall
-> shared AEGIS shadow governance
-> separate shadow ledger
```

```bash
python modeling/nfl/aegis_nfl_shadow_publisher.py \
  --blind-output data/nfl_live/blind_game.json \
  --market-input data/nfl_live/market_game.json \
  --endpoint https://aegis-sports-command-center.onrender.com/api/shadow/games
```

Set `AEGIS_SHADOW_INGEST_SECRET` in the publisher environment. The publisher
never prints the token. Use `--dry-run` to validate ordering and feature hygiene
without transmitting or persisting data. A publisher or simulator failure exits
nonzero and leaves Current AEGIS, Final Card, Autopilot, and bankroll state
unchanged.

## Automated 2026 live validation

`aegis_nfl_live_pipeline.py` removes the need to construct per-game JSON by
hand. It uses nflverse schedule and play-by-play data to construct the 25
committed v1.0 features from games completed before the prediction cutoff.
Those include rolling offensive and defensive EPA/play, early-down EPA,
success rates, play volume/sample support, rest, and divisional context.

The live fit uses the committed Ridge alphas (`80` for margin and total). It
does not refit feature selection or tune coefficients against 2026 outcomes.
The blind artifact includes win probability and margin/total distributions.
ATS and over probabilities are intentionally calculated only after capture of
the relevant market thresholds, so no sportsbook line is inserted into the
blind artifact.
QB/injury context is not a selected v1.0 feature; optional context is accepted
for diagnostics only when it carries a `known_at` timestamp no later than the
blind prediction.

Every blind result is atomically written under `data/nfl_shadow_live/blind`
before The Odds API is called. A later market phase captures consensus spread,
total, prices, bookmaker timestamp, and available movement context. Existing
blind files are reused and cannot be rebuilt after the market is visible.

```bash
# Local research dry run (still needs ODDS_API_KEY for the market phase)
python modeling/nfl/aegis_nfl_live_pipeline.py --season 2026 --mode project

# Protected shadow publish plus settled-game grading
python modeling/nfl/aegis_nfl_live_pipeline.py --season 2026 --mode all --publish
```

Settled results come from the nflverse schedule dataset. Grades remain inside
the shadow ledger and calculate blind, calibrated, and market errors; ATS/total
diagnostics; Brier scores; closing-line comparisons; CLV when available; and
the frozen AEGIS postgame taxonomy. Monitoring states can escalate only as far
as `PROMOTION_REVIEW_REQUIRED`; no state can release a pick automatically.
