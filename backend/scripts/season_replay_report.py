"""Markdown report for the season replay. Pure: ``replay_season.py``
does the running and writing."""
from __future__ import annotations

from season_replay import ReplayResult

SIMPLIFICATIONS = (
    "No chips.",
    "Each strategy's transfer policy is in its name: `xp`, `form`, `ownership` and "
    "`hindsight` make one transfer a week if it gains anything; `xp_use_banked` saves "
    "transfers for bigger gains; `xp_allow_hits` may also take one 4-point hit a week.",
    "Buy price = sell price = that round's price.",
    "No injury news: scorers only see past minutes.",
    "Starts at gameweek 5, so totals cover GW5 to the end of the season.",
    "No vice-captain: if the captain doesn't play, nobody is doubled.",
    "Transfers come from the app's own search, which shortlists 25 upgrades per "
    "squad slot before checking the budget.",
)


def render_replay_report(
    *,
    results: dict[str, ReplayResult],
    ceiling_name: str,
    season: str,
    strength_name: str,
    coefficients_label: str,
    run_date: str,
) -> str:
    ceiling_total = results[ceiling_name].total_points
    lines = [
        f"# Season replay — {season} — {run_date}",
        "",
        f"Fixture strength: {strength_name}. Coefficients: {coefficients_label}.",
        f"`{ceiling_name}` knows the actual points in advance: it is the ceiling, "
        "not a strategy anyone can follow.",
        "",
        "| strategy | total points | captain bonus | transfers | hit points | "
        "saved at end | share of ceiling |",
        "|---|---|---|---|---|---|---|",
    ]
    for name, result in sorted(results.items(), key=lambda item: -item[1].total_points):
        share = result.total_points / ceiling_total if ceiling_total else 0.0
        lines.append(
            f"| {name} | {result.total_points} | {result.captain_bonus} | "
            f"{result.transfers_made} | {result.hit_points} | "
            f"{result.free_transfers_at_end} | {share:.0%} |"
        )

    names = list(results)
    gameweeks = [week.gameweek for week in next(iter(results.values())).gameweeks]
    lines += [
        "",
        "Captain bonus is the extra points from the armband (the captain's points counted "
        "a second time). Total points are after hits. Saved at end is free transfers left "
        "unused after the last gameweek.",
        "",
        "## Points by gameweek",
        "",
        "| GW | " + " | ".join(names) + " |",
        "|---" * (len(names) + 1) + "|",
    ]
    for index, gameweek in enumerate(gameweeks):
        cells = [str(results[name].gameweeks[index].points) for name in names]
        lines.append(f"| {gameweek} | " + " | ".join(cells) + " |")

    lines += ["", "## Simplifications", ""]
    lines += [f"- {item}" for item in SIMPLIFICATIONS]
    return "\n".join(lines) + "\n"
