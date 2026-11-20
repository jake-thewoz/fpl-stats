"""Markdown report for the season replay. Pure: ``replay_season.py``
does the running and writing."""
from __future__ import annotations

from dataclasses import dataclass

from season_replay import BENCH_BOOST, FREE_HIT, TRIPLE_CAPTAIN, WILDCARD, ReplayResult
from squad_optimizer import format_millions

_NO_SHARE = "—"
CHIP_LABELS = {
    WILDCARD: "wildcard",
    FREE_HIT: "free hit",
    BENCH_BOOST: "bench boost",
    TRIPLE_CAPTAIN: "triple captain",
}

SIMPLIFICATIONS = (
    "The main table plays no chips; the Chips section, when present, adds them to `xp`.",
    "No Assistant Manager chip (2024-25).",
    "Each strategy's transfer policy is in its name: `xp`, `form`, `ownership` and "
    "`hindsight` make one transfer a week if it gains anything; `xp_use_banked` saves "
    "transfers for bigger gains; `xp_allow_hits` may also take one 4-point hit a week.",
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
    budget_tenths: int,
    season: str,
    strength_name: str,
    coefficients_label: str,
    run_date: str,
    chips: ChipComparison | None = None,
) -> str:
    """A ``ceiling_name`` missing from ``results`` leaves the share column blank."""
    ceiling = results.get(ceiling_name)
    lines = [
        f"# Season replay — {season} — {run_date}",
        "",
        f"Fixture strength: {strength_name}. Coefficients: {coefficients_label}. "
        f"Starting budget: {format_millions(budget_tenths)}.",
        f"`{ceiling_name}` knows the actual points in advance: it is the ceiling, "
        "not a strategy anyone can follow.",
        "",
        "| strategy | total points | captain bonus | transfers | hit points | "
        "saved at end | team value: start / middle / end | share of ceiling |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for name, result in sorted(results.items(), key=lambda item: -item[1].total_points):
        share = (f"{result.total_points / ceiling.total_points:.0%}"
                 if ceiling and ceiling.total_points else _NO_SHARE)
        lines.append(
            f"| {name} | {result.total_points} | {result.captain_bonus} | "
            f"{result.transfers_made} | {result.hit_points} | "
            f"{result.free_transfers_at_end} | "
            f"{format_millions(result.team_value_at_start)} / "
            f"{format_millions(result.team_value_at_middle)} / "
            f"{format_millions(result.team_value_at_end)} | {share} |"
        )

    names = list(results)
    gameweeks = [week.gameweek for week in next(iter(results.values())).gameweeks]
    lines += [
        "",
        "Captain bonus is the extra points from the armband (the captain's points counted "
        "a second time). Total points are after hits. Saved at end is free transfers left "
        "unused after the last gameweek. Team value is what selling the squad would "
        "raise plus the bank, after the first, middle and last gameweeks' transfers.",
        "",
        "## Points by gameweek",
        "",
        "| GW | " + " | ".join(names) + " |",
        "|---" * (len(names) + 1) + "|",
    ]
    for index, gameweek in enumerate(gameweeks):
        cells = [str(results[name].gameweeks[index].points) for name in names]
        lines.append(f"| {gameweek} | " + " | ".join(cells) + " |")

    if chips is not None:
        lines += render_chip_section(chips)

    lines += ["", "## Simplifications", ""]
    lines += [f"- {item}" for item in SIMPLIFICATIONS]
    return "\n".join(lines) + "\n"


@dataclass(frozen=True)
class ChipRun:
    result: ReplayResult
    gain_by_gameweek: dict[int, int]


@dataclass(frozen=True)
class ChipComparison:
    """``runs`` by chip policy name; ``baseline`` is the one with no chips."""

    strategy: str
    baseline: str
    runs: dict[str, ChipRun]
    lookahead: int
    ceiling: str


def render_chip_section(chips: ChipComparison) -> list[str]:
    baseline_total = chips.runs[chips.baseline].result.total_points
    names = list(chips.runs)
    lines = [
        "",
        "## Chips",
        "",
        f"`{chips.strategy}` with each chip policy. A chip's gain is the season total minus "
        "the total with that one chip left out. Chip policies see fixtures only "
        f"{chips.lookahead} gameweeks ahead, because the archive's fixture list is the final "
        f"one. `{chips.ceiling}` knows the actual points: it is the ceiling for chip timing.",
        "",
        "| chip policy | total points | gain over no chips | chips played (GW: chip, gain) |",
        "|---|---|---|---|",
    ]
    for name in names:
        run = chips.runs[name]
        played = ", ".join(
            f"GW{week}: {CHIP_LABELS[chip]} {run.gain_by_gameweek[week]:+d}"
            for week, chip in sorted(run.result.chips_played.items())
        ) or _NO_SHARE
        lines.append(f"| {name} | {run.result.total_points} | "
                     f"{run.result.total_points - baseline_total:+d} | {played} |")

    lines += [
        "",
        "Gain by chip, all uses added together:",
        "",
        "| chip | " + " | ".join(names) + " |",
        "|---" * (len(names) + 1) + "|",
    ]
    for chip, label in CHIP_LABELS.items():
        cells = []
        for name in names:
            run = chips.runs[name]
            cells.append(str(sum(
                run.gain_by_gameweek[week]
                for week, played in run.result.chips_played.items() if played == chip
            )))
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    return lines
