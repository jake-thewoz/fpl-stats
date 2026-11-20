# Spike: how early can we know team news, and what is it worth? (#245)

**In short:** FPL's injury flags are worth a lot. Our play-rate-only predictions badly over-rate injured regulars, and the flag fixes most of that. The app already uses flags, but it computes xP once a day at 04:30 UTC. **Before Friday evening deadlines, about a dozen flags a week change after that run**, so the app shows stale numbers. Re-running xP before Friday deadlines fixes that (#260). An outside news source isn't worth it. FPL's own news text arrives with the flag, not before it.

## 1. How far back does the history go, and does anything delete it?

- **Before this spike:** the S3 snapshots expired after 90 days, and this season's August history had already gone.
- **Fixed:**
  - Player snapshots are now kept 400 days (#258).
  - 1,503 expired snapshots were restored from S3's old versions.
  - A compact change log is kept on the laptop (`backend/scripts/spikes/archive_flag_history.py`, #257).
- **History now runs from 20 July 2026** (pre-season) to today: 5,880 snapshots, 2,050 status changes and 2,299 price changes.

## 2. When do flags change?

A **material** change is one where the chance of playing moves by 25 points or more. A chance of 100 counts as available: it's FPL's default once a flag clears. The xP analyzer runs daily at 04:30 UTC.

| GW | deadline (UTC) | material changes | in the last 24h | after the last xP run |
|---|---|---|---|---|
| 1 | Fri 17:30 | 413 (pre-season clean-up) | 13 | 12 |
| 2 | Fri 17:30 | 90 | 20 | 16 |
| 3 | Fri 17:30 | 104 | 18 | 16 |
| 4 | Sat 12:30 | 53 | 23 | 0 |
| 5 | Fri 17:30 | 69 | 19 | 17 |
| 6 | Sat 10:00 | 97 | 34 | 0 |
| 7 | Sat 10:00 | 86 | 17 | 0 |
| 8 | Fri 17:30 | 109 | 29 | 29 |
| 9 | Sat 11:00 | 88 | 20 | 0 |
| 10 | Fri 18:30 | 64 | 26 | 13 |
| 11 | Sat 11:00 | 83 | 27 | 0 |
| **all** | | 1,256 | 246 | **103** |

- About **a fifth of material changes come in the last 24 hours**. That's press-conference week.
- **Every late change is in a Friday-evening gameweek.** For Saturday-morning deadlines, the 04:30 run comes only hours before, after Friday's news has landed. For Friday-evening deadlines, the day's press conferences come after the run.

## 3. What is a flag worth?

For gameweeks 3–10, every player's prediction from the replay's play-rate signal alone, against the same prediction with the deadline flag's chance of playing in place of his play rate (as production xP does):

| player-weeks | n | play rate | played | actual pts | predicted | with flag | error without flag | error with flag |
|---|---|---|---|---|---|---|---|---|
| unflagged at deadline | 3,766 | 0.56 | 63% | 1.89 | 1.87 | 1.87 | 1.73 | 1.73 |
| flagged at deadline | 1,560 | 0.32 | 5% | 0.11 | 1.11 | 0.21 | 1.11 | 0.20 |
| **flagged, play rate ≥ 0.5** | 501 | 0.92 | **9%** | 0.25 | **3.20** | 0.46 | **3.14** | **0.43** |
| chance 0% | 1,384 | 0.30 | 1% | 0.01 | 1.01 | 0.00 | 1.01 | 0.01 |
| chance 25% | 15 | 0.60 | 40% | 1.00 | 2.13 | 0.74 | 2.27 | 1.23 |
| chance 50% | 45 | 0.47 | 42% | 0.62 | 1.65 | 1.33 | 1.39 | 1.02 |
| chance 75% | 116 | 0.59 | 44% | 1.11 | 1.97 | 2.23 | 2.01 | 2.14 |

- **The big one: flagged regulars.** About 60 a gameweek. Without flags they're predicted 3.2 points; 9% play and they average 0.25. The flag cuts the error on them by 85%. This is why the season replay, which has no flags, overrates injured players (#261).
- **"75%" flags are optimistic.** Those players played 44% of the time, so using the 75% made predictions slightly worse. The 50% and 25% flags help.

**Flags that changed after the last xP run** (GW3–10):

| player-weeks | n | played | actual pts | predicted with the flag used | error |
|---|---|---|---|---|---|
| with the last run's flag (what the app showed) | 70 | 30% | 0.79 | 1.82 | 1.89 |
| with the deadline's flag | 70 | 30% | 0.79 | 1.05 | **1.04** |

That's about **9 players a gameweek** (all in Friday-deadline weeks) whose numbers were stale at the deadline. With a fresh run, their error roughly halves.

## 4. Is there earlier news?

- **FPL's own `news` text** arrives with the flag, not before it. Across 494 status changes, `news_added` was a median of 18 minutes before our 30-minute snapshot saw the change (maximum 33). It's the same event, so it gives no extra warning.
- **Outside sources:** no free, clearly licensed feed of press-conference or predicted line-up news turned up.
  - Third-party feeds on [Apify](https://apify.com/mea/live-football-data-api) are paid per use and mostly repackage FPL's own data.
  - [Enetpulse](https://enetpulse.com/premier-league-api/) is commercial.
  - [FPL's terms](https://fantasy.premierleague.com/help/terms) and [the Premier League's](https://www.premierleague.com/en/terms-and-conditions/pl-companion) don't license their pages for automated use.
  - Scraping fan sites is out on terms grounds.

## 5. Recommendation

- **(a) Re-run xP shortly before each deadline: yes** (#260). A second daily run mid-afternoon catches Friday's news before evening deadlines. It's cheap and fixes the stale cases above.
- **(b) A flag-aware scorer for the current-season replay: yes, lower priority** (#261). The replay overrates injured regulars badly. With snapshots now kept, next season's replay can be flag-aware all year.
- **(c) An outside news source: no.** Nothing free and licensed, and FPL's flags already capture the news within half an hour.
- **(d) Nothing:** no. The flag effect is large.

## Reproduce

```bash
cd /home/jakob/dev/fpl-stats/backend/scripts && source .venv/bin/activate
python3 spikes/archive_flag_history.py   # refresh the change log from S3
python3 spikes/flag_history.py           # the tables above (reads the cache table)
```
