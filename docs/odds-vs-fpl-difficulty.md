# Spike: do bookmaker odds beat FPL difficulty? (#244)

**Verdict:** odds are a **better signal** than FPL's 1–5 fixture difficulty. Our xP model hardly uses fixture strength at all, though, so swapping odds in as a strength **does not change predictions or points**. Feeding odds in as **expected goals** does help (#255, section 4b): `odds_defence` improves accuracy in every season and points in 8 of 9 replays, by a modest +20 to +45 a season. Production can get odds free.

## 1. Data

- **Source:** [football-data.co.uk](https://football-data.co.uk/mmz4281/2526/E0.csv). One free CSV per season covers all 380 matches, from 2022-23 to 2025-26, with no gaps.
- **Two kinds of odds:**
  - **Pre-match** market average (`AvgH/D/A`, plus over/under 2.5 goals), collected on Friday afternoon for weekend games and Tuesday for midweek games. That is close to an FPL deadline, so it's what the app would really have.
  - **Closing** odds (`AvgCH/CD/CA`), used here only as an upper bound.
- **Matching to FPL:** clubs match FPL's `teams.csv` by name, with three renames (`Man United`, `Tottenham`, `Sheffield United`). Each home/away pairing happens once a season, so no dates are needed.

## 2. Odds as a fixture strength

`backend/scripts/odds.py` turns odds into the same 0–1 "opponent strength" the model gets from FPL difficulty:
- Take the opponent's expected share of the result (a win counts 1, a draw ½), after removing the bookmaker's margin.
- The odds already include home advantage, and xP adds its own. So the league's typical home share is subtracted first, measured from the **previous** season so nothing leaks from the one being predicted.
- Odds are used only for the **next** gameweek, because bookmakers don't price matches further ahead. Later weeks fall back to FPL difficulty. (`odds_all_weeks` drops that limit, for comparison only.)

## 3. Results

**Signal test.** For both sides of every match, how well opponent strength ranks goals conceded and clean sheets (Spearman ρ; higher is better for goals conceded, more negative is better for clean sheets):

| season | source | ρ goals conceded | ρ clean sheet |
|---|---|---|---|
| 2023-24 | FPL difficulty | 0.306 | −0.148 |
| 2023-24 | odds (pre-match) | **0.381** | **−0.234** |
| 2023-24 | odds (closing) | 0.399 | −0.247 |
| 2024-25 | FPL difficulty | 0.269 | −0.208 |
| 2024-25 | odds (pre-match) | **0.351** | **−0.247** |
| 2024-25 | odds (closing) | 0.358 | −0.256 |
| 2025-26 | FPL difficulty | 0.256 | −0.203 |
| 2025-26 | odds (pre-match) | **0.264** | **−0.232** |
| 2025-26 | odds (closing) | 0.263 | −0.229 |

- Pre-match odds beat FPL difficulty in all three seasons: clearly in 2023-24 and 2024-25, slightly in 2025-26.
- Closing odds add very little, so waiting until kick-off isn't needed.

**Prediction accuracy** (`replay_accuracy.py`, every player, every gameweek from GW5): no difference.

| season | FPL difficulty (MAE / ρ / captain points) | odds |
|---|---|---|
| 2023-24 | 0.975 / 0.638 / 207 | 0.975 / 0.638 / 203 |
| 2024-25 | 1.006 / 0.650 / 286 | 1.007 / 0.650 / 279 |
| 2025-26 | 0.976 / 0.685 / 237 | 0.977 / 0.685 / 231 |

**Why no difference:** even "every opponent is mid-table" scores the same as FPL difficulty (2025-26 ρ: 0.684 against 0.685). The model's fixture-strength weights (`opp_strength_w_*` in `xp_v2_coefficients.json`) are small. Who plays, and how often they score, outweighs the opponent. A better strength source can't show up through such a weak input.

**Season replay** (points, GW5–38): every difference is within the ~150-point noise, in both directions.

| season | `xp`: FPL / odds | `xp_use_banked`: FPL / odds |
|---|---|---|
| 2023-24 | 1807 / 1880 | 1873 / 1900 |
| 2024-25 | 1866 / 1848 | 2111 / 2007 |
| 2025-26 | 1947 / 1996 | 1954 / 1943 |

I also tried tripling the fixture-strength weights. The totals moved randomly for both sources, which says a bigger weight alone is not the fix.

## 4. The stronger use

Odds give each team's **expected goals** in a match directly: the home/draw/away price together with the over/under 2.5 goals price. Clean sheets (`P(0 conceded)`), goals conceded and an attacking boost can then come straight from those expected goals, instead of a season-average rate nudged by a 0–1 strength. That's where the better signal could reach the points. It's a model change to `xp_v2`, though, so it's filed as follow-up **#255** and not attempted in this spike.

## 4b. Results of the stronger use (#255)

`xp_v2.FixtureContext` gained two optional per-match multipliers: `concede_multiplier` (it replaces the clean-sheet and goals-conceded fixture factor) and `attack_multiplier` (it replaces the goals and assists factor). Left empty, which is the case in production, nothing changes. `odds.py` turns the home/draw/away and over/under 2.5 prices into each side's expected goals, assuming independent Poisson scores. I tried three ways to feed them in, all using odds for the next gameweek only:

| Variant (`--strength`) | Clean sheets and goals conceded | Goals and assists |
|---|---|---|
| absolute (first try, not kept) | the odds' expected goals conceded used directly | this match ÷ the team's usual |
| `odds_goals` | this match ÷ the team's **usual** goals conceded | this match ÷ the team's usual |
| **`odds_defence`** | this match ÷ the **league average**, scaled by the league's goals-conceded rate over the team's own. The odds' view of each defence replaces ours | this match ÷ the team's usual |

**The absolute version was miscalibrated.** The odds themselves are well calibrated: a 26.1% implied clean-sheet rate against 25.5% actual in 2025-26. But the fitted weights (`cs_w` ≈ 0.45, `concede_w` ≈ 1.4) were tuned to correct our own goals-conceded input, so they halve clean sheets a second time. Goalkeepers and defenders came out ~35% below their actual average. That flattered the error figure (most player-weeks score 0), so I dropped it. The two relative versions keep the model's units and need no refit.

**Accuracy** (`replay_accuracy.py`; overall error / ranking ρ, defender ρ, captain points):

| season | FPL difficulty | `odds_goals` | **`odds_defence`** |
|---|---|---|---|
| 2023-24 | 0.975 / 0.638, DEF 0.539, 207 | 0.971 / 0.641, DEF 0.544, 187 | **0.960 / 0.644, DEF 0.553**, 199 |
| 2024-25 | 1.006 / 0.650, DEF 0.581, 286 | 1.002 / 0.651, DEF 0.583, 310 | **1.000 / 0.651, DEF 0.584**, 311 |
| 2025-26 | 0.976 / 0.685, DEF 0.627, 237 | 0.972 / 0.686, DEF 0.629, 229 | **0.968 / 0.686, DEF 0.632**, 229 |

- `odds_defence` is better on error and ranking in every season, with the biggest gains for goalkeepers and defenders.
- Average predicted goalkeeper and defender points stay level with FPL difficulty's.
- The captain test is mixed. It turns on attackers, and the attack multiplier helps less than the defence one.

**Season replay** (points, GW5–38):

| strategy | FPL difficulty | `odds_goals` | **`odds_defence`** |
|---|---|---|---|
| `xp` | 1807 / 1866 / 1947 | 1817 / 1935 / 1992 | **1868 / 1870 / 2015** (+61, +4, +68) |
| `xp_use_banked` | 1873 / 2111 / 1954 | 1870 / 2045 / 2033 | **1879 / 2117 / 2007** (+6, +6, +53) |
| `xp_planner_h3` | 1859 / 2029 / 1964 | 1835 / 2104 / 1989 | **1868 / 2004 / 1986** (+9, −25, +22) |

`odds_defence` gains in 8 of 9 runs, and every strategy wins at least two of three seasons. Each gain is small, about +20 to +45 points a season, which is below the single-season noise. The consistency is what makes it believable. Using odds for every week ahead (`odds_goals_all_weeks`, a leak) adds little over the next week alone.

**Verdict for #255:** a real but modest improvement. Worth building into production if a live odds feed is cheap to run (section 5).

## 5. What production would need

- **Source:** [The Odds API](https://the-odds-api.com/sports/epl-odds.html) has a free plan of 500 credits a month, with Premier League home/draw/away and over/under ("totals") markets.
- **Cost:** a call costs about markets × regions credits, so one daily fetch of both markets for one region is about 2 credits, or ~60 a month.
- **History:** historical odds are paid only. Past seasons keep coming from football-data.co.uk.
- **How early:** odds usually appear about a week ahead, which covers the next gameweek, exactly what this spike assumed.
- **Next steps:** a scheduled fetch into DynamoDB, plus the model change. Both belong to the follow-up.

## Not covered

Player-level odds (anytime scorer, assists) could replace our own per-player goal rates. That's a possible next step after the team-level change.

## Reproduce

```bash
cd /home/jakob/dev/fpl-stats/backend/scripts && source .venv/bin/activate
python3 strength_signal.py --season 2023-24 --season 2024-25 --season 2025-26
python3 replay_accuracy.py --season 2025-26 --strength odds --dry-run
python3 replay_season.py --season 2025-26 --strength odds --strategy xp --strategy xp_use_banked --dry-run
```
