# NCAAF v0.2 research candidate

`NCAAF_v0.2_RESEARCH_CANDIDATE` is a blind, research-only successor candidate to
v0.1. It does not change the production NCAAF engine, release gates, staging
deployment, or any official AEGIS accounting.

## Frozen chronology

- 2019–2021: training foundation
- 2022: validation A and hyperparameter selection
- 2023: validation B / final research confirmation
- 2019–2023: final refit after the design is selected
- 2024–2025: `OBSERVED_AUDIT_NOT_UNTOUCHED`, evaluated once after freezing
- 2026: next genuinely untouched live shadow evidence

Runtime assertions reject 2024–2025 from every fitting path. The selected ridge
penalty, calibration penalty, prior pseudo-sample, and ensemble mean weights all
come from the 2022 validation-A search. No market value is accepted by the
statistical baseline or blind calibration layer.

## Architecture

1. Leakage-safe v0.1 feature snapshot and prior-season raw history.
2. Smooth Bayesian team-state blend using effective games and plays.
3. `NCAAF_v0.2_STATISTICAL_BASELINE`, fit with standardized ridge regression.
4. `NCAAF_v0.2_POSSESSION_SIMULATOR`, retaining matchup logic and producing
   independent halves, conditional second-half distributions, starter-removal,
   pace-suppression, and garbage-time behavior.
5. Validation-selected mean ensemble. Validation A selected 100% statistical
   mean and 0% simulator mean for both margin and total; the possession simulator
   remains the score-distribution layer. This avoids forcing an unsupported blend.
6. `NCAAF_v0.2_BLIND_MONOTONIC_CALIBRATION`, using blind output, dispersion,
   quality, effective sample size, cross-class, structural-break, and evidence
   state only. The raw-margin coefficient is constrained nonnegative.
7. Research-only uncertainty firewall. Sparse cross-class games, confirmed
   structural breaks, very low support, extreme blind-implied margins, or extreme
   dispersion can return `PASS`.

## Selected research configuration

- Prior equivalent sample: 3 games
- Statistical ridge alpha: 200
- Blind calibration ridge alpha: 200
- Statistical mean weight: 1.0 for margin and total
- Possession-simulator mean weight: 0.0; distribution role retained
- Production promotion allowed: false

The full coefficient artifact and the complete validation/audit report live in
`modeling/ncaaf/results/`. `NCAAF_V02_LIVE_SHADOW_READY` means only that the
candidate may begin untouched 2026 shadow evidence collection. It does not permit
official Final Card, bankroll, Autopilot, or production release eligibility.

