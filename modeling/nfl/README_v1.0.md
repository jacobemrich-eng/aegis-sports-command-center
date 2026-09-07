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
