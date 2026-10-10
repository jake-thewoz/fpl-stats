# xP (Expected Points) Model

The xP model predicts how many fantasy points each player will score in
upcoming gameweeks. It drives:

- The **xP column** on the players list and "my team" screens (single-GW prediction).
- **Transfer suggestions** ranking (multi-GW horizon).
- The **current-squad-xP** header and per-card `delta_xp` on the analytics screen.

This document covers the production model — sometimes referred to as
"xP v2" in commits and code. (A simpler "v1" model existed previously
and was retired in PR #127. Code paths and tests no longer reference it.)

## What it predicts

For each player, the model produces:

- A **single-GW total** for the immediate-next gameweek (used by the xP column).
- A **per-GW breakdown** across the next 5 gameweeks (used by transfer suggestions, which sums any subset the user requests via `?horizon=N`, default 3, max 5).

Both are stored as Decimals on a single DDB row per player at
`pk = analytics#player_xp_v2, sk = <player_id>`. The single-GW total
(`xp` field) is just `horizon_xp_by_gw[upcoming_gw]`.

Output is in real points units — a player whose xP is 5.4 is predicted
to score 5.4 FPL points. Captain EV is just this doubled; consumers can
multiply for any chip.

## Architecture at a glance

```
                              FPL public API
                              (fantasy.premierleague.com)
                                       │
            ┌──────────────────────────┴────────────────────────┐
            ▼                                                   ▼
  /bootstrap-static/                                  /element-summary/{id}/
  /fixtures/                                          (per-player history)
  /event/{gw}/live/                                          │
            │                                                ▼
            ▼                                       ingest_player_history Lambda
  ingest_fpl Lambda                                          │
            │                                                ▼
            ▼                                  pk=fpl#player_history#{id}
  pk=fpl#bootstrap                             sk=gw#{round:03d}#fixture#{fixture}
  pk=fpl#fixtures                                            │
            │                                                ▼
            └─────────────────┬──────────────► xp_v2_features.compute_rates_at_gw
                              │                (point-in-time, Bayesian-shrunk)
                              ▼                              │
                  analyze_player_xp_v2 Lambda  ◄─────────────┘
                  (daily 04:30 UTC)                     ▼
                              │             xp_v2.xp_for_horizon
                              ▼                              │
                              └──────────────────────────────┘
                              │
                              ▼
                   pk=analytics#player_xp_v2, sk=<player_id>
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
  GET /analytics/players/xp        GET /analytics/squad/{id}/transfers?horizon=N
  (analytics_players_xp Lambda)    (analyze_transfer_suggestions Lambda)
            │                                   │
            ▼                                   ▼
        Mobile: xP column           Mobile: transfer suggestions
                                    + current-squad-xP header
```

## The math

For each player + each GW in the horizon:

```
xp = appearance + goals + assists + cs + concede
   + saves + bonus + defcon + discipline
```

Each component is computed independently. Output is in real FPL points.

### Component formulas

| Component | Formula | Notes |
|---|---|---|
| Appearance | `p60 × 2 + (p_any − p60) × 1` | 2 pts for ≥60 min, 1 pt for 1–59 min |
| Goals | `goal_pts[pos] × p60 × npxg_p90 × goals_w[pos] × factor` | Position-stratified (GK/DEF=6, MID=5, FWD=4) |
| Assists | `3 × p60 × xa_p90 × assists_w[pos] × factor` | All positions, 3 pts each |
| Clean sheet | `cs_pts[pos] × p60 × exp(−team_xgc_p90 × factor) × cs_w[pos]` | Poisson P(0 conceded). FWD CS pts = 0. |
| Concede | `−1 × p60 × (team_xgc_p90 × factor) / 2 × concede_w[pos]` | GK/DEF only. −1 per 2 conceded. |
| Saves | `(saves_p90 × factor) / 3 × p_any × saves_w[GKP]` | GK only. 1 pt per 3 saves. |
| Defcon | `2 × p_any × defcon_per_match_rate × defcon_w[pos] × factor` | DEF/MID/FWD. +2 when threshold met. |
| Bonus | `min(3, bonus_p90 × p60 × bonus_w[pos] × factor)` | Capped at 3 per fixture |
| Discipline | `−1 × yc_p90 × p_any + −3 × rc_p90 × p_any` | Yellow + red card penalty |

`factor = 1 + home_advantage·sign + opp_strength_w_<component> × (opp_strength − 0.5)`

`opp_strength` is `(fpl_difficulty − 1) / 4` (0.0 for easy, 1.0 for hard,
0.5 for neutral). Sign convention on `opp_strength_w_*`: negative for
attacking components (stronger opp = less output), positive for defensive
ones (stronger opp = more saves / defcon work / conceded).

### Defcon threshold

The `defensive_contribution` field FPL ships per-match is the
position-aware count compared to the threshold:

- **DEF**: threshold 10. The dc field = clearances + blocks + interceptions + tackles.
- **MID/FWD**: threshold 12. The dc field = CBI + tackles + recoveries.

If `dc ≥ threshold` the player triggers the +2 defcon bonus that match.
The `defcon_per_match_rate` rate stored per player is just the historical
fraction of matches where they triggered.

### Availability and minutes probability

Every component formula above is gated on `p_any` (P(plays at all)) or
`p60` (P(plays ≥60 min | plays at all)). The same `p_any` is reused
across both fixtures of a DGW, which is why getting it right is
load-bearing — a wrong `p_any=1.0` for a never-picked fringe player
combined with a 2-fixture DGW produces the bug that drove issue #134
(Crystal Palace bench warmers ranking above genuine starters).

**Two-stage signal** (`layers/fpl_schemas/python/xp_compute.py:minutes_probability_with_selection`):

1. **FPL signal first.** `chance_of_playing_next_round` (`cop`) when
   it indicates a real doubt — `cop in {0, 25, 50, 75}` → return
   `cop/100`. These are the curated values FPL ships when a player is
   injured, suspended, or returning from a doubt.
2. **Empirical dampener otherwise.** When FPL has no specific signal —
   `cop is None` OR `cop == 100` — fall back to `season_play_rate`
   (see below). `cop=100` is FPL's *default-fill* for "no concern",
   not a positive "going to play" signal: it covers ~60% of available
   players (319 of 528 sampled on 2026-04-30), including never-picked
   fringes. Treating it the same as `cop=null` is correct and aligns
   the dampener semantic across both buckets.
3. **Status='a' required for the dampener path.** A player flagged
   with `status='i'/'s'/'u'/'n'` returns 0.0 regardless of rate.

**Season play rate** (`layers/fpl_schemas/python/xp_v2_features.py:season_play_rate`):

```
season_play_rate = min(1.0, season_minutes / (90 × gws_completed))
```

`season_minutes` is the bootstrap's cumulative `Player.minutes`;
`gws_completed` is the count of `gameweeks[i].finished == True`. A
guaranteed starter lands near 1.0 (no-op); a 4th-choice CB with 50
minutes after 30 GWs lands near 0.018 (collapses xP appropriately).

Two guards:

- **Min-GWs threshold (`_SEASON_PLAY_RATE_MIN_GWS = 4`).** Below 4
  completed GWs the rate is too noisy to trust; the helper returns
  1.0 (no dampening, behaviour identical to pre-fix). The recommender
  is constrained by lack of data in those GWs anyway.
- **Returning-from-injury under-rating.** A starter who missed 4–6 GWs
  has their season rate dragged down by the absence (e.g., 1500 mins
  + a 4-GW absence ≈ 56% rate). Accepted as v1 trade-off; a recent-N-
  GW window would address this and is tracked as a follow-up issue.

**Horizon decay** (`layers/fpl_schemas/python/xp_v2.py:availability_curve`):

`xp_for_horizon` interpolates `p_any` from the GW-0 base toward 1.0
across the horizon (`AVAILABILITY_DECAY_CURVE = (0.0, 0.4, 0.7, 0.9, 1.0)`).
A flagged-50% player gets 0.5 next GW, 0.7 the GW after, 1.0 by GW+4 —
captures typical short-term injury recovery without modelling per-injury
detail. `p60` for each horizon GW is `p_any × historical_p60`. This
applies on top of the dampened base, so a fringe player with
`p_any=0.018` decays toward 1.0 the same way; their xP rises across
the horizon but stays low because the per-90 rates and `p60` also
lift along with `p_any`. The dampener is doing the right thing across
all horizon offsets.

**Where the dampened value is surfaced.** `analyze_player_xp_v2`
writes `season_play_rate` into the stored `components` map next to
`minutes_prob`, so debug consumers can tell "low xP because injured
(cop=0)" from "low xP because never picked (rate≈0)".

### DGW handling

`xp_for_gameweek` sums components across however many fixtures the
team has that GW. Two fixtures → up to 2× appearance, 2× CS chance,
2× bonus cap, etc. Falls out naturally from the loop, no special case.

### Blank GW

`fixtures_by_gw[gw] = []` → all-zero components for that GW. Players
whose team blanks the immediate-next GW get **no row written** — a
missing row in DDB means "no fixture this GW", whereas xp=0 would
mean "predicted to score nothing", a different signal.

## The data pipeline

The model has two distinct update cadences. Understanding this split
is the thing future-dev should grok before changing anything.

### 1. Per-player rates — recomputed nightly, automatic

The inputs to the math (`npxg_p90`, `xa_p90`, `team_xgc_p90`, `saves_p90`,
`bonus_p90`, `defcon_per_match_rate`, `yc_p90`, `rc_p90`,
`historical_p60`) come from the player's per-fixture history rows. Every
nightly writer run reads the latest history and recomputes these
freshly.

**Pipeline**:

| File | Role |
|---|---|
| `lambdas/ingest_player_history/handler.py` | Weekly Sun 02:00 UTC. Pulls `/element-summary/{id}/` for ~700 players, writes `pk=fpl#player_history#{id}` rows. |
| `layers/fpl_schemas/python/xp_v2_features.py` | `compute_rates_at_gw` — turns history rows into smoothed per-90 rates with strict point-in-time (no leakage). `compute_team_xgc_at_gw` — team-side xGC, deduped by fixture. |
| `layers/fpl_schemas/python/xp_v2_priors.json` | Position-level prior rates (e.g. mid xG/90 = 0.15) used for Bayesian shrinkage. |

The two load-bearing invariants in the feature pipeline:

1. **No future leakage.** `compute_rates_at_gw(history, position, as_of_gw=t)` filters rows to `round < t` strictly. Defensive `assert max(filtered.round) < t` catches any future bug that weakens the filter — silent leakage poisons backtests without symptoms.

2. **Bayesian shrinkage.** A rookie's one freak 5 xG match becomes `npxg_p90 ≈ 1.12`, not 5.0. With `prior_strength_matches = 4`, a player with 2 matches is heavily pulled toward the position prior; after ~10 matches their own data dominates. Empty-history collapses to the pure prior (handles pre-season + brand-new transfers).

### 2. Coefficients — fitted manually ~4× per season

The "weights" the math multiplies through (`goals_w[pos]`, `cs_w[pos]`,
`opp_strength_w_*`, etc., ~30 numbers total) describe the *structural
relationship* between underlying stats and points scored. They barely
move week-to-week (the league's xG-to-goals conversion rate, home
advantage, opponent suppression) and don't need to update with every
new GW.

**Pipeline**:

| File | Role |
|---|---|
| `layers/fpl_schemas/python/xp_v2.py` | The math itself. Pure compute, no I/O. `xp_for_fixture`, `xp_for_gameweek`, `xp_for_horizon`, plus the `ScoringRules` and `V2Coefficients` dataclasses. |
| `layers/fpl_schemas/python/xp_v2_coefficients.json` | Bundled coefficients. Loaded at Lambda init via `load_default_coefficients()`. |
| `scripts/fit_xp_v2.py` | Offline calibration. Mean-matches per-component-per-position weights against actual outcomes on the training set, writes new JSON. |
| `scripts/fit_reports/<date>.md` | Markdown reports per fit run, committed alongside the JSON change. |

**Cadence**: pre-season, GW5, GW15, GW25 — captures structural shifts
(new managers, mid-season meta, scoring rule tweaks like 25/26's defcon)
without overfitting on weekly noise.

A snapshot test at
`layers/fpl_schemas/tests/test_xp_v2.py:test_default_coefficients_synthetic_set_snapshot`
pins the bundled JSON's behaviour on five synthetic players (Haaland,
Bruno, Gabriel, Pickford, flagged). It fails until updated whenever
the JSON changes — forcing an explicit acknowledgement that the model
moved.

### 3. Predictions — written nightly, served from DDB

| File | Role |
|---|---|
| `lambdas/analyze_player_xp_v2/handler.py` | Daily 04:30 UTC. Computes per-player xP for the next 5 GWs, writes one row per player at `pk=analytics#player_xp_v2`. |
| `lambdas/analyze_player_xp_v2/compute.py` | `opp_strength_from_difficulty` and `build_fixture_context` — translate FPL fixture difficulty (1–5) into the model's continuous opp_strength signal (0.0–1.0). |
| `lambdas/analyze_transfer_suggestions/v2_horizon.py` | `read_v2_horizon_xps` — reads the precomputed horizon and sums whatever subset the user's `?horizon=N` selects. Single Query, ~100 ms. |
| `lambdas/analytics_players_xp/handler.py` | `GET /analytics/players/xp` — slim per-player projection for the mobile xP column. Reads from `analytics#player_xp_v2`. |

## Validation: the backtest

`scripts/backtest_xp.py` replays every historical fixture, computes
v2 predictions using only data available before that fixture, and
compares to actual outcomes. Pass criteria for any model change to
ship:

1. MAE overall — strictly less than the previous version
2. Spearman ρ overall — equal or higher (rank correlation drives
   transfer / captain decisions)
3. No position regresses by >5% on MAE
4. Captain pick total — sum of actual points scored by the model's
   #1 prediction each GW, equal or higher

The most recent run is committed at `scripts/backtest_results/<date>.md`.
The script was originally built to compare v1 vs v2 (see
`scripts/v1_replay.py` — left intact post-retirement because it's
useful for any future iteration). For changes that don't introduce a
new model, the same harness can run with two versions of v2 (e.g. before
and after a coefficient re-fit).

## How to make common changes

### Change a per-position weight

Edit `layers/fpl_schemas/python/xp_v2_coefficients.json`. Bump the
relevant `<component>_w[<pos>]` value. Update the snapshot test at
`layers/fpl_schemas/tests/test_xp_v2.py:test_default_coefficients_synthetic_set_snapshot`
with the new expected totals (re-run the script in
`scripts/fit_xp_v2.py`'s docstring against the synthetic set, or
just compute by hand). Deploy and verify via the snapshot test.

### Re-fit coefficients from production history

Run the fit:

```bash
cd backend/scripts
source .venv/bin/activate
TABLE=$(aws cloudformation describe-stacks --stack-name FplStatsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CacheTableName`].OutputValue' \
  --output text)
python3 fit_xp_v2.py --table-name "$TABLE" --dry-run   # eyeball first
python3 fit_xp_v2.py --table-name "$TABLE"              # commit-mode
```

Outputs: updated `xp_v2_coefficients.json` + a dated `fit_reports/<date>.md`.
The snapshot test will fail until you update its expected values; that's
intentional — re-compute by running `scripts/fit_xp_v2.py` against the
synthetic test data, or just paste the assertion failures' actuals.

### Add a new component

Pick one not currently modelled (e.g. penalty save bonus is currently
folded into the saves/discipline lines but could be its own component).

1. Add the component math to `xp_v2.py`'s `xp_for_fixture` + extend
   `XpV2Components`.
2. Add a `<component>_w` field to `V2Coefficients` + the JSON.
3. Add a `<rate>_p90` field to `PerNinetyRates` + the smoothing in
   `xp_v2_features.compute_rates_at_gw`.
4. Update `decompose_actual_xp` in `scripts/fit.py` so the calibration
   harness can compare predicted to actual.
5. Update tests across the layer + writer + reader to assert the new
   component's behaviour.
6. Run the backtest to confirm the new component doesn't regress.

### Backfill missing history

If `fpl#player_history` rows are stale (e.g. ingest_player_history
hasn't run for a while), trigger it manually:

```bash
FUNC=$(aws lambda list-functions \
  --query 'Functions[?starts_with(FunctionName, `FplStatsStack-IngestPlayerHistory`)].FunctionName | [0]' \
  --output text)
aws lambda invoke --cli-read-timeout 600 --function-name "$FUNC" \
  --payload '{}' --cli-binary-format raw-in-base64-out /tmp/ingest-out.json
cat /tmp/ingest-out.json | python3 -m json.tool
```

Takes ~3 minutes (sequential 700-player fetch with 50ms inter-call sleep).

### Verify the model is healthy in production

A few quick checks:

```bash
TABLE=$(aws cloudformation describe-stacks --stack-name FplStatsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CacheTableName`].OutputValue' --output text)

# Are predictions current?
aws dynamodb get-item --table-name "$TABLE" \
  --key '{"pk":{"S":"analytics#player_xp_v2"},"sk":{"S":"449"}}' \
  --query 'Item.{web_name:web_name.S, gameweek:gameweek.N, computed_at:computed_at.S, xp:xp.N}' \
  --output json
```

Bruno (449) should have a `gameweek` matching the upcoming GW and
a `computed_at` from the last 24h.

```bash
# CW alarms for any analyzer in the v2 path:
aws cloudwatch describe-alarms \
  --alarm-name-prefix "FplStatsStack-" \
  --query "MetricAlarms[?contains(AlarmName, 'AnalyzePlayerXpV2') || contains(AlarmName, 'AnalyzePlayerForm') || contains(AlarmName, 'IngestPlayerHistory')].[AlarmName, StateValue]" \
  --output table
```

All should be `OK`.

## Coefficient and prior tuning rationale

Position-aware behaviours encoded in the bundled `xp_v2_coefficients.json`
and `xp_v2_priors.json`:

- `saves_w[outfield] = 0` — outfield can't accumulate save points.
- `defcon_w[GKP] = 0` — keepers are ineligible for defcon in 25/26.
- `concede_w[MID/FWD] = 0` — only GK/DEF lose points to concessions.
- `cs_w[FWD] = 0` — forwards don't earn clean sheet points.

These are **belt-and-suspenders zeros** — the math also short-circuits
ineligible positions via `if position not in ...` checks. Keeping the
coefficient at zero too means the Phase 3 fit doesn't spend gradient
budget on disabled components.

`opp_strength_w_*` signs are component-specific and meaningful:

- Negative (`opp_strength_w_goals`, `..._assists`, `..._cs`, `..._bonus`):
  stronger opponent → less attacking output / lower CS prob / fewer
  bonus pts.
- Positive (`opp_strength_w_concede`, `..._saves`, `..._defcon`):
  stronger opponent → more conceded / more save chances / more defensive
  work for defcon-eligible positions.

A future fit that flips one of these signs is the smell to watch for
when reviewing a coefficient JSON change. The snapshot test enforces
that any sign flip surfaces in the reviewer's diff.

## Glossary

- **xP**: expected points — the model's prediction for one (player, GW).
- **GW / gameweek**: an FPL match round (1–38).
- **DGW**: double gameweek — a team plays two fixtures in one GW.
- **Blank GW**: a team plays zero fixtures in one GW (cup conflicts, etc.).
- **xG / xA / xGI / xGC**: expected goals / assists / goal involvements / goals conceded — FPL's underlying-stats family, per-player per-match.
- **Defcon**: defensive contributions — the +2 bonus for defenders/mids/fwds who clear a CBIT or CBITR threshold per match (25/26+ scoring rule).
- **CBIT**: clearances + blocks + interceptions + tackles. The DEF defcon basis.
- **CBIT+R**: CBIT + recoveries. The MID/FWD defcon basis.
- **`p_any`** (a.k.a. `minutes_prob`): P(player plays at all this match), in [0, 1]. Computed by `minutes_probability_with_selection` — combines FPL's `cop` field (when it signals a real doubt, `0/25/50/75`) with `season_play_rate` (when FPL is silent, including the `cop=100` default-fill case).
- **`p60`**: P(player plays ≥60 min | plays at all), in [0, 1]. `p_any × historical_p60`.
- **`season_play_rate`**: empirical "the manager actually picks this player" signal — `season_minutes / (90 × gws_completed)`, clamped to [0, 1]. Returns 1.0 below `_SEASON_PLAY_RATE_MIN_GWS = 4` completed GWs (rate too noisy with a tiny denominator).
- **`cop`**: FPL's `chance_of_playing_next_round` field, 0/25/50/75/100 or null. **Quirk**: `cop=100` is FPL's default-fill for "no concern" and covers ~60% of the available pool, including never-picked fringes. Only `cop in {0, 25, 50, 75}` carries a real availability signal — see issue #134's resolution.
- **`opp_strength`**: continuous fixture-difficulty signal in [0, 1] derived from FPL's 1–5 difficulty rating. 0.5 = mid-tier opponent (factor unchanged).
- **`team_xgc_p90`**: team-side expected goals conceded per 90 min — drives both clean-sheet probability (Poisson `P(0 conceded)`) and the concede penalty.
