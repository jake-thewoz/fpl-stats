# Design: xP from all competitions

**Status:** proposal, not started. Nothing here is built.

## Summary

The xP model only sees Premier League matches. Players also play in the
Champions League, Europa League, Conference League, FA Cup and League
Cup, and those matches carry evidence about form, fitness and role that
the model ignores today.

This proposes a second xP value alongside the current one:

- **`xp`** — today's model, PL matches only. Unchanged.
- **`xp_all`** — the same model, with non-PL matches added as
  opposition-adjusted, down-weighted evidence.

Both predict the same thing: **PL fantasy points**. `xp_all` ships to
the app only if it beats `xp` in the backtest.

## Key idea: convert matches to model inputs, not to FPL points

The model never reads a player's past FPL points. It builds smoothed
per-90 rates from per-fixture history (`npxg_p90`, `xa_p90`,
`bonus_p90`, `yc_p90`, `rc_p90`, `saves_p90`, `defcon_per_match_rate`,
team `xgc_p90`) in `xp_v2_features.compute_rates_at_gw`, then runs them
through the scoring formulas in `xp_v2.py`. See
[xp-model.md](xp-model.md).

So rather than inventing an FPL-points approximation for cup matches,
each non-PL match becomes a **history row with the same fields as a PL
row**, opposition-adjusted and tagged with a weight. Both values then
come from one scoring path, so any gap between `xp` and `xp_all` is
caused by the extra data, not by two scoring systems drifting apart.

## Design

### 1. Data source

Need per-player, per-match stats for UCL / UEL / UECL / FA Cup / League
Cup: minutes, npxG, xA, goals, assists, cards, saves (GK), and the
defensive actions behind defcon (tackles, clearances, blocks,
interceptions, recoveries).

| Option | Coverage | Cost / risk |
|---|---|---|
| Opta / StatsBomb (licensed) | Full | Paid. The right answer if the app goes public. |
| FotMob / Sofascore | Full, incl. xG | Unofficial APIs; terms forbid scraping. OK for a private spike, not for a public app. |
| API-Football, football-data.org | Fixtures, lineups, minutes | Cheap/free tiers; little or no xG. |

**Open question:** which source. This decides whether the project is
viable and is the first thing to settle (see Phase 0).

### 2. Player and team ID mapping

FPL element IDs must map to the provider's player IDs. Approach: fuzzy
name match within a club (club + name + position), plus a small
hand-maintained override table checked into the repo. Unmatched players
fall back to PL-only (`xp_all == xp`).

### 3. Opposition strength across competitions

FPL's 1–5 fixture difficulty only covers PL teams. Cross-competition
adjustment needs one rating scale across leagues, e.g. a club Elo
(ClubElo or similar). Each non-PL row's attacking stats are scaled
relative to an average PL opponent, and defensive stats the other way,
so a hat-trick against a fourth-tier side counts for much less than the
raw numbers suggest.

A first version can use a simple multiplicative factor per stat; the
exponent/slope is a fitted coefficient, like the existing
`opp_strength_w_*`.

### 4. Down-weighting non-PL evidence

Even after adjustment, cup matches are noisier (rotated lineups on both
sides, unusual game states). Non-PL rows contribute minutes and stats
scaled by a weight `w` (initial guess 0.3–0.6) inside the existing
Bayesian shrinkage:

```
smoothed_p90 = 90 · (Σ stat_pl + w · Σ stat_adj_nonpl + k · prior_p90)
               / (Σ min_pl + w · Σ min_nonpl + k · 90)
```

`w` may differ by competition (UCL vs League Cup). The backtest sets it.

### 5. Components that need special handling

- **Bonus:** there's no BPS outside the PL. `bonus_p90` stays PL-only.
- **Minutes / availability:** `season_play_rate`, `p_any` and `p60` stay
  PL-based. Starting every League Cup match often signals *not* starting
  in the league. Possible later use: a "has returned from injury and
  played" signal for players flagged by FPL.
- **Team xGC (clean sheets / concede):** could take non-PL team matches
  with the same adjustment, but start PL-only and add it as a separate
  experiment.

### 6. Point-in-time correctness

`compute_rates_at_gw` filters rows with `round < as_of_gw` to avoid
future leakage. Non-PL matches have no FPL round, so each one must be
assigned to a gameweek by kickoff time: a match counts toward GW `t`
only if it kicked off before GW `t`'s deadline. The existing defensive
assertion should cover the new rows too.

### 7. Storage and serving

- **Ingest:** a new weekly Lambda (`ingest_non_pl_history`) writes rows
  under their own key, e.g.
  `pk=ext#player_history#{fpl_id}`, `sk=<kickoff_iso>#<comp>#<match_id>`,
  with competition, opponent rating, assigned GW and the raw + adjusted
  stats. Kept separate from `fpl#player_history` so the PL-only path is
  untouched.
- **Compute:** `analyze_player_xp_v2` runs the horizon twice, writing
  the existing row and a new one at `pk=analytics#player_xp_v2_all`.
  Cost doubles on a cheap job; well within free tier.
- **API:** `GET /analytics/players/xp` gains an optional `xp_all` field.
- **Mobile:** a second column or a toggle on the xP column and player
  detail. Only after the backtest passes.

## Validation

Reuse `scripts/backtest_xp.py` with two variants (`xp` vs `xp_all`) and
the existing pass criteria: lower MAE overall, Spearman ρ equal or
higher, no position regressing by >5% MAE, captain-pick total equal or
higher.

Also report results split by **players with little PL history** (new
signings, players back from injury, promoted squads). The expectation is
that this is where `xp_all` helps; for established starters it should
barely move.

If `xp_all` fails overall but wins on low-PL-history players, an option
is to show it only for those players, or to use it as a better prior
rather than a second headline number.

## Phases

0. **Data-source spike.** Pick a source, pull one season of non-PL
   matches for a handful of clubs, hand-map IDs. Go/no-go on coverage
   and terms of use.
1. **Ingest.** `ingest_non_pl_history` Lambda + ID mapping + opponent
   ratings + GW assignment. Display-only: show all-competitions minutes
   and xG on player detail.
2. **Model.** Add an "include non-PL rows with weight `w`" option to
   `compute_rates_at_gw`; produce `xp_all` offline.
3. **Backtest.** Fit `w` and the opposition slope; decide whether
   `xp_all` ships.
4. **Ship.** Write `analytics#player_xp_v2_all`, expose it in the API,
   add it to the app.

## Open questions

- Data source and its licence, given "eventually public".
- Opposition rating source and how far down the pyramid it reaches
  (League Cup / FA Cup opponents from League One and below).
- One `w` or one per competition?
- Should the opposition adjustment also apply to team xGC from day one?
