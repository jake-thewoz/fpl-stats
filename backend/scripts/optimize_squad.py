"""Pick the best 15-player squad, XI and captain for a budget.

For wildcards and free hits, where the transfer suggester (capped at
five swaps from the current squad) cannot help. Reads the xP that
production already computed, so it is only as good as that xP.

Usage:
    python3 optimize_squad.py --table-name "$TABLE" --budget 100.0

FPL does not publish selling prices, so the budget cannot be read from
the API: on the FPL transfers screen, add "money remaining" to your
squad's selling value and pass the total as --budget.
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import boto3

# Layer's python/ and the transfer suggester on sys.path, so the squad
# rules and the xP reader are shared with production rather than copied.
_THIS_DIR = Path(__file__).parent
_LAYER_PY_DIR = _THIS_DIR.parent / "layers" / "fpl_schemas" / "python"
_TRANSFER_LAMBDA_DIR = _THIS_DIR.parent / "lambdas" / "analyze_transfer_suggestions"
sys.path.insert(0, str(_TRANSFER_LAMBDA_DIR))
sys.path.insert(0, str(_LAYER_PY_DIR))
sys.path.insert(0, str(_THIS_DIR))

from compute import MAX_PLAYERS_PER_TEAM  # noqa: E402
from data import load_bootstrap  # noqa: E402
from schemas import Bootstrap, utc_now  # noqa: E402
from squad_optimizer import (  # noqa: E402
    Candidate,
    NoFeasibleSquad,
    OptimizedSquad,
    SquadRules,
    optimize_squad,
)
from v2_horizon import read_v2_horizon_xps  # noqa: E402
from xp_compute import upcoming_gameweek_ids  # noqa: E402
from xp_v2 import DEF, FWD, GKP, MID  # noqa: E402

log = logging.getLogger(__name__)

_DEFAULT_HORIZON = 5
_MAX_HORIZON = 5
_DEFAULT_BENCH_WEIGHT = 0.1
_TENTHS_PER_MILLION = 10
# 'a' = available, 'd' = doubtful (xP already discounts the doubt).
# Injured, suspended and unavailable players are left out entirely.
_SELECTABLE_STATUSES = frozenset({"a", "d"})
_POSITION_LABELS = {GKP: "GKP", DEF: "DEF", MID: "MID", FWD: "FWD"}


def build_candidates(
    *,
    bootstrap: Bootstrap,
    horizon_xps: dict[int, float],
    next_gw_xps: dict[int, float],
) -> list[Candidate]:
    """Selectable players as optimizer candidates. A player with no xP
    row (blank gameweek, or new to the game) counts as 0 xP."""
    return [
        Candidate(
            player_id=player.id,
            web_name=player.web_name,
            team_id=player.team,
            position=player.element_type,
            cost_tenths=player.now_cost,
            horizon_xp=horizon_xps.get(player.id, 0.0),
            next_gw_xp=next_gw_xps.get(player.id, 0.0),
        )
        for player in bootstrap.players
        if player.status in _SELECTABLE_STATUSES
    ]


def render_squad(
    *,
    squad: OptimizedSquad,
    team_short_names: dict[int, str],
    gameweek_ids: list[int],
    budget_tenths: int,
) -> str:
    def millions(tenths: int) -> str:
        return f"£{tenths / _TENTHS_PER_MILLION:.1f}m"

    def line(player: Candidate) -> str:
        captain_mark = " (C)" if player.player_id == squad.captain.player_id else ""
        return (
            f"  {_POSITION_LABELS[player.position]}  "
            f"{player.web_name + captain_mark:<22}"
            f"{team_short_names.get(player.team_id, '?'):<5}"
            f"{millions(player.cost_tenths):>7}"
            f"{player.next_gw_xp:>8.2f}"
            f"{player.horizon_xp:>9.2f}"
            f"   id {player.player_id}"
        )

    by_position_then_xp = lambda p: (p.position, -p.horizon_xp)  # noqa: E731
    # FPL convention: the spare keeper first, then outfield subs in the
    # order they should come on.
    bench_order = lambda p: (p.position != GKP, -p.next_gw_xp)  # noqa: E731
    header = (
        f"  {'':<3}  {'player':<22}{'club':<5}{'cost':>7}"
        f"{'GW' + str(gameweek_ids[0]):>8}{'horizon':>9}"
    )
    lines = [
        f"Gameweeks {gameweek_ids[0]}–{gameweek_ids[-1]} "
        f"({len(gameweek_ids)} gameweeks of xP)",
        "",
        "Starting XI",
        header,
        *(line(p) for p in sorted(squad.starters, key=by_position_then_xp)),
        "",
        "Bench",
        *(line(p) for p in sorted(squad.bench, key=bench_order)),
        "",
        f"Cost: {millions(squad.total_cost_tenths)} of {millions(budget_tenths)} "
        f"({millions(budget_tenths - squad.total_cost_tenths)} left)",
        f"Starting XI xP over the horizon: {squad.starters_horizon_xp:.1f}",
        f"Captain: {squad.captain.web_name} "
        f"({squad.captain.next_gw_xp:.2f} xP next gameweek)",
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--table-name", required=True,
                        help="DynamoDB cache table name (CacheTableName CFN output).")
    parser.add_argument("--budget", type=float, required=True,
                        help="Total budget in £m, e.g. 100.4.")
    parser.add_argument("--horizon", type=int, default=_DEFAULT_HORIZON,
                        choices=range(1, _MAX_HORIZON + 1),
                        help=f"Gameweeks of xP to sum (default {_DEFAULT_HORIZON}).")
    parser.add_argument("--bench-weight", type=float, default=_DEFAULT_BENCH_WEIGHT,
                        help="How much a bench player's xP counts relative to a "
                             f"starter's (default {_DEFAULT_BENCH_WEIGHT}).")
    parser.add_argument("--lock", type=int, action="append", default=[],
                        metavar="PLAYER_ID", help="Force a player in. Repeatable.")
    parser.add_argument("--exclude", type=int, action="append", default=[],
                        metavar="PLAYER_ID", help="Keep a player out. Repeatable.")
    parser.add_argument("--region", default="us-east-1")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.WARNING,
                        format="%(levelname)s %(name)s: %(message)s")

    table = boto3.resource("dynamodb", region_name=args.region).Table(args.table_name)
    bootstrap = load_bootstrap(table)
    gameweek_ids = upcoming_gameweek_ids(bootstrap.gameweeks, args.horizon, utc_now())
    if not gameweek_ids:
        log.error("No upcoming gameweeks: the season is over.")
        return 1

    candidates = build_candidates(
        bootstrap=bootstrap,
        horizon_xps=read_v2_horizon_xps(table=table, horizon_gw_ids=gameweek_ids),
        next_gw_xps=read_v2_horizon_xps(table=table, horizon_gw_ids=gameweek_ids[:1]),
    )
    budget_tenths = round(args.budget * _TENTHS_PER_MILLION)
    try:
        squad = optimize_squad(
            candidates=candidates,
            budget_tenths=budget_tenths,
            rules=SquadRules(max_players_per_team=MAX_PLAYERS_PER_TEAM),
            bench_weight=args.bench_weight,
            locked_ids=frozenset(args.lock),
            excluded_ids=frozenset(args.exclude),
        )
    except (NoFeasibleSquad, ValueError) as error:
        log.error("%s", error)
        return 1

    print(render_squad(
        squad=squad,
        team_short_names={team.id: team.short_name for team in bootstrap.teams},
        gameweek_ids=gameweek_ids,
        budget_tenths=budget_tenths,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
