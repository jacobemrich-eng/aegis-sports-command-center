# SB101 AEGIS NFL v0.9 — Market Challenger Calibration + Disagreement Firewall

v0.9 does not put sportsbook information into the blind NFL model.

The sequence remains:

blind NFL projection
→ independent consensus market projection
→ post-model calibration
→ disagreement firewall
→ AEGIS governance.

## Learned blend

For each future historical week, v0.9 uses only earlier out-of-sample predictions to learn how much weight the internal model deserves relative to the market.

It learns separate weights for:
- margin mean,
- total mean,
- ATS probability,
- over/under probability,

with disagreement buckets:
- <=1
- 1–2
- 2–3
- 3–5
- 5–7
- 7+

Bucket estimates are shrunk toward the global learned weight.

## Disagreement Firewall

Grounded in the clean v0.8 audit:

- 7+ points: PASS
- 5–7: Secondary maximum
- 3–5: Core blocked unless reliability supports otherwise
- poor historical buckets automatically cap internal-model weight

This prevents "AEGIS disagrees by 8, therefore huge edge" behavior.

## Promotion

Production release remains disabled.

v0.9 is promoted only if the clean post-model calibration improves out-of-sample performance without compromising probability calibration.

## Command Center adapter

The production web process does not import or execute this Python research
stack. A simulator run sends its completed blind output plus the separately
computed Market Challenger context to `POST /api/shadow/games`. The Node
adapter maps that result to `AEGIS_STANDARD_GAME_OUTPUT_v1`, re-applies the
disagreement firewall, and persists it in the separate shadow ledger.

This keeps the request path failure-safe and preserves independent development:
NFL math remains here, while shared schema validation, governance metadata,
Supabase persistence, and UI presentation live under `src/sport-engines` and
`src/shadow-service.js`.

There is no v1.0 ablation/coefficient-calibration implementation or committed
v1.0 result in this branch. v0.9 remains the latest verified NFL calibration.
