"""Markdown report for the season replay. Pure: ``replay_season.py``
does the running and writing."""
from __future__ import annotations

from season_replay import ReplayResult

SIMPLIFICATIONS = (
    "One free transfer a week, never banked, no hits, no chips.",
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
        "| strategy | total points | captain bonus | transfers | share of ceiling |",
        "|---|---|---|---|---|",
    ]
    for name, result in sorted(results.items(), key=lambda item: -item[1].total_points):
        share = result.total_points / ceiling_total if ceiling_total else 0.0
        lines.append(
            f"| {name} | {result.total_points} | {result.captain_bonus} | "
            f"{result.transfers_made} | {share:.0%} |"
        )

    names = list(results)
    gameweeks = [week.gameweek for week in next(iter(results.values())).gameweeks]
    lines += [
        "",
        "Captain bonus is the extra points from the armband (the captain's points counted "
        "a second time).",
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
