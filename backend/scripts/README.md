# `backend/scripts/` — offline xP-v2 utilities

Local-only Python scripts. **Nothing here ships to AWS** — the heavy
deps (boto3, pandas-equivalent) stay out of Lambda's bundle. The only
artifact these scripts produce that ships is a few JSON files in the
shared layer (`xp_v2_coefficients.json`, `xp_v2_priors.json`).

## `fit_xp_v2.py` — recalibrate v2 coefficients from cached history

Run manually ~4× per season at the cadence agreed in the v2 plan
(pre-season, GW5, GW15, GW25). Reads every cached
`fpl#player_history#*` row from the cache table, builds point-in-time
training pairs through the Phase 2 feature pipeline, and mean-matches
per-component-per-position weights against actual outcomes.

### Setup (first time only)

```bash
cd backend/scripts
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Usage

```bash
TABLE=$(aws cloudformation describe-stacks --stack-name FplStatsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CacheTableName`].OutputValue' \
  --output text)

# Dry run first — prints the report and what *would* be written, without
# touching the bundled JSON. Use this on every fit.
python3 fit_xp_v2.py --table-name "$TABLE" --dry-run

# If the report looks sane, re-run without --dry-run to commit the
# new coefficients + a dated fit-report file.
python3 fit_xp_v2.py --table-name "$TABLE"
```

### What the fit does

For each `(component, position)` pair (e.g. `goals_w[MID]`), the new
weight is the old weight times `sum(actual_component) / sum(predicted_component)`
on the training set. This is the simplest calibration that produces
per-position-correct component contributions on average. The training
set is everything except the last 5 GWs; metrics are reported on the
held-out validation set so we can see whether mean-matching generalizes.

### What the fit explicitly does NOT do

- **Re-fit `home_advantage` or `opp_strength_w_*`.** History rows don't
  carry an `opponent_strength` signal yet, so any "fit" of those slopes
  would be uninformed. Phase 3.x augments the training data with fixture
  difficulty (or ClubELO win-prob) and refits these.
- **Re-fit `overall_scale[pos]`.** Per-component mean-matching already
  calibrates absolute level. If Phase 4 backtest reveals residual bias
  at the position level, `overall_scale` becomes the right knob.
- **Re-fit position priors in `xp_v2_priors.json`.** Those control
  feature smoothing, not predictions; Phase 3.x will re-fit from
  historical aggregates.

### After running the fit

1. Inspect the printed/written report — the dated file lands in
   `backend/scripts/fit_reports/<date>.md`.
2. Eyeball the sanity checks (no sign flips, weights in plausible
   ranges).
3. The `test_default_coefficients_synthetic_set_snapshot` test in
   `backend/layers/fpl_schemas/tests/test_xp_v2.py` will fail until you
   update the expected totals — this is intentional, the snapshot is
   designed to force an explicit acknowledgement that the model has moved.
4. Open a PR with the JSON change, the report, and the snapshot test
   update. Reviewer reads the report and approves.

## Tests

```bash
cd backend/scripts
source .venv/bin/activate
python3 -m pytest tests/ -v
```

Unit tests cover the pure fit logic (mean-matching, decompose, time-
series split, ranking metrics, report rendering) on synthetic data.
DDB integration is verified manually via the `--dry-run` workflow above.
