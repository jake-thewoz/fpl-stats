"""Honest single-gameweek accuracy: every player predicted, not only
those who played, scored against real FPL points (0 for a player with
no row that week).

Pure: ``replay_accuracy.py`` does the loading and writing.
"""
from __future__ import annotations

from collections import defaultdict

from backtest import (
    BacktestRow,
    captain_pick_actual_total,
    mae_by_position,
    mae_overall,
    spearman_by_position,
    spearman_overall,
)
from fit import POSITION_NAMES
from replay_predictions import FixtureStrength, predict_horizon
from season_data import SeasonData
from xp_v2 import DEF, FWD, GKP, MID, V2Coefficients
from xp_v2_features import FeatureWindow, PositionPriors

# Before this round the features are mostly position priors and the play
# rate isn't applied yet, so accuracy is measured from here on.
DEFAULT_FIRST_SCORED_GAMEWEEK = 5
SINGLE_GAMEWEEK_HORIZON = 1
# The backtest metrics score one of two prediction slots; replay rows
# carry their single prediction in both.
SCORED_MODEL = "v2"
_REPORT_POSITIONS = (GKP, DEF, MID, FWD)


def single_gameweek_rows(
    *,
    season: SeasonData,
    first_gameweek: int,
    coefs: V2Coefficients,
    priors: PositionPriors,
    window: FeatureWindow,
    fixture_strength: FixtureStrength,
) -> list[BacktestRow]:
    """One row per (player, gameweek) from ``first_gameweek`` to the last
    played round, predicting each gameweek as if standing just before it."""
    actual_by_player_round: dict[tuple[int, int], int] = defaultdict(int)
    for row in season.rows:
        actual_by_player_round[(row.element, row.round)] += row.total_points
    last_gameweek = max(row.round for row in season.rows)

    rows: list[BacktestRow] = []
    for gameweek in range(first_gameweek, last_gameweek + 1):
        predictions = predict_horizon(
            season, gameweek, SINGLE_GAMEWEEK_HORIZON, coefs, priors, window, fixture_strength,
        )
        for player_id, by_gameweek in predictions.items():
            predicted = by_gameweek[gameweek]
            rows.append(BacktestRow(
                player_id=player_id,
                round=gameweek,
                position=season.position_by_player[player_id],
                v1_pred=predicted,
                v2_pred=predicted,
                actual_total=actual_by_player_round[(player_id, gameweek)],
            ))
    return rows


def render_accuracy_report(
    *,
    rows: list[BacktestRow],
    season: str,
    strength_name: str,
    run_date: str,
) -> str:
    rounds = sorted({row.round for row in rows})
    round_range = f"{rounds[0]}–{rounds[-1]}" if rounds else "(none)"
    mae = mae_by_position(rows, model=SCORED_MODEL)
    spearman = spearman_by_position(rows, model=SCORED_MODEL)
    lines = [
        f"# Replay accuracy — {season}, {strength_name} fixture strength — {run_date}",
        "",
        f"Every player predicted for one gameweek at a time, GW {round_range}, "
        f"{len(rows)} player-gameweeks. A player with no match that week scored 0.",
        "",
        "| position | MAE | Spearman ρ |",
        "|---|---|---|",
    ]
    for position in _REPORT_POSITIONS:
        lines.append(
            f"| {POSITION_NAMES[position]} | {_fmt(mae.get(position))} | "
            f"{_fmt(spearman.get(position))} |"
        )
    lines.append(
        f"| **overall** | {_fmt(mae_overall(rows, model=SCORED_MODEL) if rows else None)} | "
        f"{_fmt(spearman_overall(rows, model=SCORED_MODEL) if rows else None)} |"
    )
    lines.append("")
    lines.append(
        f"Captain test (actual points of the top prediction each week, not doubled): "
        f"{captain_pick_actual_total(rows, model=SCORED_MODEL):.0f} over {len(rounds)} gameweeks."
    )
    return "\n".join(lines) + "\n"


def _fmt(value: float | None) -> str:
    return "—" if value is None else f"{value:.3f}"
