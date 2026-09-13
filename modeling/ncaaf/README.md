# AEGIS NCAAF shadow research

This directory is a new, mathematically independent NCAAF research stack. Repository history contained no `modeling/ncaaf` v0.1–v0.5 artifacts. The protected production reference remains the SB101 logic in `src/engine.js`; this package does not call or alter it.

Historical predecessor: `NCAAF_v0.1_POSSESSION_ENSEMBLE_CANDIDATE`. Current research candidate: `NCAAF_v0.2_RESEARCH_CANDIDATE`. Independent post-lock market challenger: `NCAAF_v0.1_INDEPENDENT_MARKET_CHALLENGER`. Monitoring remains `INSUFFICIENT_SAMPLE`; production promotion and automatic release are disabled.

The fixed research ensemble contains Power, Efficiency/EPA, Drive Efficiency, Matchup/Trenches, Personnel/Situational, and Explosiveness/Havoc components. A deterministic drive simulation provides the score distribution. The 1H estimate has its own drive count, scripted-offense and continuity terms; it is not half of the full-game mean.

All feature sources require a `known_at` timestamp before kickoff. Missing roster, transfer, availability, EPA, or drive inputs reduce data quality and can trigger structural-break/early-season Core blocks. FBS/FCS uncertainty is explicit. Market data is requested only after the entire slate's blind files exist.

`aegis_ncaaf_walkforward.py` preserves the v0.1 audit. The v0.2 research path uses 2019–2021 training, 2022 validation A, and 2023 validation B. The already-observed 2024–2025 seasons are audit-only and cannot enter fitting. See `V02_RESEARCH.md` and the frozen artifacts under `results/`. A `LIVE_SHADOW_READY` research result permits only the collection of untouched 2026 shadow evidence; it is not production approval.

Expected source credentials are `CFBD_API_KEY` for CollegeFootballData and `ODDS_API_KEY` for post-blind market capture. Live discovery uses ESPN's public pregame schedule feed. Missing values fail closed or lower quality; they are never invented.

## Future read-only Research / Shadow Lab

The normal site should read a server-side, sanitized view of `state.shadow_engines` through an authenticated read-only endpoint. Browser code must never receive the ingest secret or Supabase credentials. The endpoint must whitelist display fields, deny mutations, and remain disconnected from `latest_cards`, official audit/results, locks, bankroll and Autopilot. NFL, NCAAF and later MLB remain separate sport partitions behind that read model.
