# SB101 AEGIS NFL — v0.7 Shadow Modeling Stack

This directory is intentionally isolated from the production Node.js AEGIS engine while the NFL stack is validated on real historical data.

## Model stack

Drive distribution → QB/injury → pressure/trenches → PROE/game-state pace/coaching → independent Q1/1H → NFL key-number calibration → Market Expression Optimizer → AEGIS governance → standardized Command Center output.

## Historical integrity

- Week W uses only earlier games.
- Sportsbook spread/total are **not** internal predictive features.
- The market remains an independent challenger.
- nflverse's schedule `spread_line` sign is converted to the AEGIS convention (`home favorite = negative`).
- Regular season and preseason remain separate.
- The workflow never authorizes real-bet release; output remains shadow-only until Champion/Challenger governance is satisfied.

## Real validation

The GitHub Actions workflow `.github/workflows/aegis-nfl-real-walkforward.yml` downloads public nflverse play-by-play for 2021-2025, builds leakage-free pregame snapshots, runs expanding walk-forward validation, compares the blind internal model with the independent market consensus, and uploads predictions/report/status as artifacts.

The workflow is research-only. A favorable historical run does not automatically promote NFL v0.7 to production.
