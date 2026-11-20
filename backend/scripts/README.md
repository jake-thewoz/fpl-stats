# `backend/scripts/` — offline xP-v2 utilities

Local-only Python scripts. **Nothing here ships to AWS** — the heavy
deps (boto3, pandas-equivalent) stay out of Lambda's bundle. The only
artifact these scripts produce that ships is a few JSON files in the
shared layer (`xp_v2_coefficients.json`, `xp_v2_priors.json`).

## `fit_xp_v2.py` — recalibrate v2 coefficients from four past seasons plus this one

Run manually from about GW8, then every ~10 gameweeks (GW8, GW18, GW28).
Trains on the four archive seasons (see `season_archive.py`) plus the
current season from the cache table, builds point-in-time training pairs
one season at a time through the Phase 2 feature pipeline, and
mean-matches per-component-per-position weights against actual outcomes.
A ship gate decides whether the new weights get written.

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

# Dry run first: prints the report, writes nothing. Exit code 1 means
# the ship gate failed.
python3 fit_xp_v2.py --table-name "$TABLE" --dry-run

# Writes the dated fit report, and the coefficients only if the gate passes.
python3 fit_xp_v2.py --table-name "$TABLE"
```

`--force` writes the coefficients even when the gate fails.
`--holdout-rounds` (default 3) and `--min-train-round` (default 5) adjust
the split described below.

### What the fit does

For each `(component, position)` pair (e.g. `goals_w[MID]`), the new
weight is the old weight times `sum(actual_component) / sum(predicted_component)`
on the training set. This is the simplest calibration that produces
per-position-correct component contributions on average.

- **Training** = every archive season plus the current season except its
  last 3 rounds, with rounds below 5 dropped (early-round features are
  mostly position priors, so weights learned there don't transfer).
- **Validation** = the current season's last 3 rounds, unfiltered.
- **Season filter**: a component is only fitted on seasons where its
  current scoring rule existed: defcon from 2025-26, bonus from 2026-27
  (`FIRST_VALID_SEASON_BY_COMPONENT` in `fit.py`).
- **Kept weights**: a bucket keeps its old weight when nothing was
  predicted, when there were no actual events (a zero weight could never
  recover), or when fewer than 30 training rows had an event (one
  goalkeeper assist once pushed `assists_w[GK]` to 10.4). The report
  lists each kept bucket and why.

**Ship gate** (`fit_gate.py`), judged on validation, old vs new weights:
overall MAE lower, no position's MAE more than 1% worse, overall
Spearman ρ down by no more than 0.005, and the sanity checks pass.

**Early season:** the archive makes training data plentiful from day one,
but validation is the current season's last 3 rounds, so a fit before
~GW8 is judged on early-season noise.

### What the fit explicitly does NOT do

- **Re-fit `home_advantage` or `opp_strength_w_*`.** History rows don't
  carry an `opponent_strength` signal yet, so any "fit" of those slopes
  would be uninformed. Phase 3.x augments the training data with fixture
  difficulty (or an Elo win-prob, #166) and refits these.
- **Re-fit `overall_scale[pos]`.** Per-component mean-matching already
  calibrates absolute level. If Phase 4 backtest reveals residual bias
  at the position level, `overall_scale` becomes the right knob.
- **Re-fit position priors in `xp_v2_priors.json`.** Those control
  feature smoothing, not predictions; Phase 3.x will re-fit from
  historical aggregates.

### After running the fit

1. Inspect the printed/written report — the dated file lands in
   `backend/scripts/fit_reports/<date>.md`. It opens with the gate's
   PASS/FAIL and which rule failed.
2. If the gate failed, the JSON is unchanged: commit just the report.
   Otherwise eyeball the sanity checks and kept-weight table.
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

## `optimize_squad.py` — best 15 for a budget (wildcard / free hit)

The transfer suggester searches up to five swaps from your current
squad, so it cannot plan a wildcard. This script picks the whole squad:
15 players, the starting XI and the captain that maximise xP under the
budget, position and three-per-club rules. It solves the choice exactly
with an integer-programming solver (PuLP's bundled CBC) in about a
second. Read-only: it reads the bootstrap and the production xP rows.

```bash
cd /home/jakob/dev/fpl-stats/backend/scripts
source .venv/bin/activate
pip install -r requirements.txt
TABLE=$(jq -r '.FplStatsStack.CacheTableName' /home/jakob/dev/fpl-stats/backend/.deploy-outputs.json)

python3 optimize_squad.py --table-name "$TABLE" --budget 100.0
```

Flags:

- `--budget` (required): total in £m. FPL does not publish selling
  prices, so read it off the FPL transfers screen: money remaining plus
  the selling value of your squad.
- `--horizon` (default 5): how many upcoming gameweeks of xP to sum.
- `--bench-weight` (default 0.1): how much a bench player's xP counts
  next to a starter's. Raise it for a stronger bench.
- `--lock <id>` / `--exclude <id>`: force a player in or out. Repeatable.
  Player ids are printed at the end of each row.

What it does not do: chips, price changes, planning later transfers, or
re-picking the XI each gameweek (one XI is chosen for the whole
horizon). Injured and suspended players are left out. The result is
only as good as the xP behind it.

The logic lives in `squad_optimizer.py` (pure, tested in
`tests/test_squad_optimizer.py`); the season replay will reuse it.

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

## `replay_accuracy.py` — honest single-gameweek accuracy

`replay_predictions.predict_horizon(season, as_of_gw, horizon, ...)`
gives every player's xP for the next `horizon` gameweeks, using only what
was known before `as_of_gw` (the fixture list aside). It is the engine the
season replay runs on. Chance of playing is the season play rate so far;
the archive has no injury flags. Opponent strength is pluggable:
`NeutralStrength` (0.5) or `FplDifficultyStrength` (FPL's 1–5 difficulty).

`replay_accuracy.py` predicts each gameweek from 5 on for **every** player
(0 points if they didn't play) and reports MAE and Spearman ρ:

```bash
cd backend/scripts
source .venv/bin/activate
python3 replay_accuracy.py --season 2025-26 --strength neutral
python3 replay_accuracy.py --season 2025-26 --strength fpl
```

Writes `backtest_results/replay-accuracy-<season>-<strength>-<date>.md`
(`--dry-run` only prints). Non-players dominate these rows and are easy to
predict, so the numbers are not comparable with `backtest_xp.py`'s.

## `replay_season.py` — does following xP win FPL points?

A simulated manager plays a past season from gameweek 5, one gameweek at
a time, seeing only the past: best squad for £100.0m at the start, then
each week one transfer if it gains, the best XI, a captain and
auto-subs, scored with real points. Strategies differ in how they rate
players: `xp` (the app's model), `form` (last 4 gameweeks), `ownership`
(what the crowd owns) and `hindsight` (actual points, the ceiling).

Transfers follow FPL's rules: unused free transfers are saved up to
five, and extra ones cost 4 points. What to do with them is a transfer
policy (`replay_policies.py`): `one_a_week` (the default for the
strategies above), `use_banked` (`xp_use_banked`: saves transfers for
bigger gains), `allow_hits` (`xp_allow_hits`: may also take one hit a
week) or none (`xp_no_transfers`).

Money follows FPL's rules: a player sells for his purchase price plus
half of any rise (rounded down to £0.1m), or his full current price
after a fall. The report shows each strategy's team value (squad selling
value + bank) at the start, middle and end.

```bash
cd backend/scripts
source .venv/bin/activate
python3 replay_season.py --season 2025-26 --strength fpl
python3 replay_season.py --season 2025-26 --strength fpl --coefficients candidate.json
python3 replay_season.py --season 2025-26 --strength fpl --budget 102 --strategy xp --dry-run
```

Writes `backtest_results/replay-<season>-<strength>-<date>.md` (with
`-budget<£m>` before the date for a non-default `--budget`), about 4
seconds. `--strategy` (repeatable) replays only the named strategies. **No model change ships unless the `xp` total goes up.** Swings
of about 150 points come from the starting squad alone, so treat a small
gain as noise. Rules and simplifications are in `season_replay.py`'s
docstring; scorers in `replay_strategies.py`.

## `season_archive.py` — past seasons for the fit and replay

Our cache only holds the current season (FPL renumbers player ids every
August). `load_archive_season("2024-25")` returns a full past season as
`SeasonData`; `load_current_season(table)` returns the current one from
DynamoDB in the same shape. Archive files download once into
`.season_cache/<season>/` (gitignored). Use seasons 2022-23 onwards,
when expected-goals fields start.

Cleaning rules (assistant-manager rows dropped, duplicate matches
collapsed, the archive's leaky `xP` column never read) live in
`season_data.py`, tested in `tests/test_season_data.py`.

**Data sources:** past seasons come from
[vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League),
the community archive of the official FPL API.

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
