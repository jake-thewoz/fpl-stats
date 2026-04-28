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

## `backtest_xp.py` — gate v2's promotion against v1

Phase 4. Loads the same history rows the fit script uses, replays both
**v1** (the production formula `form × easiness × minutes × num_fixtures`)
and **v2** (the per-component model in this branch), and scores both
against actual outcomes. The first section of the markdown report is
the **pass/fail verdict** — v2 ships only if all four criteria pass.

### Usage

```bash
TABLE=$(aws cloudformation describe-stacks --stack-name FplStatsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CacheTableName`].OutputValue' \
  --output text)

# Dry-run prints the report without writing it to backtest_results/.
python3 backtest_xp.py --table-name "$TABLE" --dry-run

# Real run writes the report + a JSON sidecar dated by today's UTC date.
python3 backtest_xp.py --table-name "$TABLE"
```

Exit code is 0 when v2 passes all criteria, 1 when it fails — useful
for any future CI gate.

### Pass criteria

1. **MAE overall** — v2 strictly less than v1
2. **Spearman ρ overall** — v2 ≥ v1 (rank correlation drives transfer
   suggestions and captain picks)
3. **Per-position regression** — no single position's MAE regresses
   by more than 5%
4. **Captain pick total** — sum of actual points scored by each
   model's top-ranked player per GW; v2 ≥ v1

A failure on any one criterion blocks **Phase 5 (#116)** promotion.
Iterate on Phase 1 (math), Phase 2 (features), or Phase 3 (fit) and
re-run.

### Approximations to be aware of

- **`minutes_prob`** uses the observed-minutes oracle (1.0 if played,
  0.0 otherwise) — we don't have historical snapshots of FPL's
  `chance_of_playing_next_round`. Both v1 and v2 use the same oracle,
  so the comparison is apples-to-apples; the absolute MAE numbers are
  optimistic compared to real-time inference.
- **Fixture difficulty** is read from the *current* `fpl#fixtures`
  cache. FPL adjusts these rarely, but historical values may differ
  slightly. Phase 3.x can fix this by archiving fixture snapshots.

## `delete_v1_xp_rows.py` — one-off legacy cleanup

The v1 analyzer Lambda was retired alongside the v2 cutover (#118 +
follow-up). Its ~700 per-player rows at `pk=analytics#player_xp` are no
longer read by anything; this script batch-deletes them so the cache
table stops carrying dead data.

Run once after the v1-retirement PR deploys. Idempotent — a second run
finds nothing.

```bash
cd backend/scripts
source .venv/bin/activate

TABLE=$(aws cloudformation describe-stacks --stack-name FplStatsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CacheTableName`].OutputValue' \
  --output text)

# Optional dry-run to confirm what's there.
python3 delete_v1_xp_rows.py --table-name "$TABLE" --dry-run

# Actually delete.
python3 delete_v1_xp_rows.py --table-name "$TABLE"
```

## Tests

```bash
cd backend/scripts
source .venv/bin/activate
python3 -m pytest tests/ -v
```

Unit tests cover the pure fit logic, the v1 replay arithmetic, the
backtest metrics (top-K hit rate, captain pick, pass criteria edge
cases), and report rendering on synthetic data. DDB integration is
verified manually via the `--dry-run` workflows above.
