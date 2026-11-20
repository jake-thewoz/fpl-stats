# Spike: do bookmaker odds beat FPL difficulty? (#244)

**Verdict:** odds are a **better signal** than FPL's 1–5 fixture difficulty. Our xP model hardly uses fixture strength at all, though, so swapping odds in **does not change predictions or points yet**. Build it in only together with a model change that makes fixture strength count (follow-up #255). Production can get odds free.

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
