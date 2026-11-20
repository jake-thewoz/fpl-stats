"""Transfer planner tests on a hand-built pool, answers worked out by hand."""
from __future__ import annotations

from compute import HIT_COST_POINTS, suggest_transfer_bundles
from schemas import Player
from squad_optimizer import SquadRules
from transfer_planner import PlanSettings, PlayerOption, pair_moves, plan_transfers
from xp_v2 import DEF, FWD, GKP, MID

PRICE = 50
SQUAD_POINTS = 2.0
# Squad players score a hair more the higher their id, so the weakest in
# each position (the lowest id) is the one to sell.
TIEBREAK_PER_ID = 0.01
# A small game: 2 GKP, 3 DEF, 3 MID, 2 FWD; 7 start (1 GKP, ≥2 DEF, ≥2 MID, ≥1 FWD).
RULES = SquadRules(
    max_players_per_team=3,
    squad_size_by_position={GKP: 2, DEF: 3, MID: 3, FWD: 2},
    starters=7,
    min_starters_by_position={GKP: 1, DEF: 2, MID: 2, FWD: 1},
    max_starters_by_position={GKP: 1},
)
SETTINGS = PlanSettings(rules=RULES)
# Squad 1-10 and their like-for-like replacements 11-20, each on his own club.
POSITION_BY_PLAYER = {
    1: GKP, 2: GKP, 3: DEF, 4: DEF, 5: DEF, 6: MID, 7: MID, 8: MID, 9: FWD, 10: FWD,
    11: GKP, 12: GKP, 13: DEF, 14: DEF, 15: DEF, 16: MID, 17: MID, 18: MID, 19: FWD, 20: FWD,
}
SQUAD = frozenset(range(1, 11))


def _options(points: dict[int, tuple[float, ...]], horizon: int, *,
             price: dict[int, int] = {}, club: dict[int, int] = {}) -> list[PlayerOption]:
    """Squad players score about ``SQUAD_POINTS`` a week, others 0, unless listed."""
    return [
        PlayerOption(
            player_id=player_id, position=position, club=club.get(player_id, player_id),
            price=price.get(player_id, PRICE), sell_price=price.get(player_id, PRICE),
            points_by_week=points.get(
                player_id,
                (SQUAD_POINTS + TIEBREAK_PER_ID * player_id if player_id in SQUAD else 0.0,)
                * horizon),
        )
        for player_id, position in POSITION_BY_PLAYER.items()
    ]


def _plan(options, *, bank=0, free_transfers=1, settings=SETTINGS):
    return plan_transfers(options=options, squad=SQUAD, bank=bank,
                          free_transfers=free_transfers, settings=settings)


def _moves(plan, week=0):
    return pair_moves(plan.weeks[week], POSITION_BY_PLAYER)


def test_one_week_plan_agrees_with_the_app_search():
    points = {16: (6.0,), 17: (3.0,), 13: (2.5,)}
    options = _options(points, horizon=1)
    plan = _plan(options)

    def player(option: PlayerOption) -> Player:
        return Player(id=option.player_id, first_name="", second_name="", web_name="",
                      team=option.club, element_type=option.position, total_points=0,
                      form="", now_cost=option.price)
    bundles = suggest_transfer_bundles(
        squad=[player(o) for o in options if o.player_id in SQUAD], bank=0,
        candidate_pool=[player(o) for o in options if o.player_id not in SQUAD],
        horizon_xps={o.player_id: o.points_by_week[0] for o in options},
        free_transfers=1, max_transfers=1, top_n=1,
    )
    (move,) = bundles[0].moves
    assert _moves(plan) == [(move.out_player_id, move.in_player_id)] == [(6, 16)]


def test_saves_a_transfer_when_waiting_is_worth_more():
    # Week 1: MID 17 is a small upgrade. Week 2: MID 16 and DEF 13 are big
    # ones. Spending now leaves one free transfer for two big moves.
    points = {17: (2.5, 2.5), 16: (0.0, 9.0), 13: (0.0, 9.0)}
    plan = _plan(_options(points, horizon=2))
    assert _moves(plan, 0) == []
    assert sorted(_moves(plan, 1)) == [(3, 13), (6, 16)]
    assert plan.weeks[1].hits == 0


def test_takes_a_hit_only_when_the_gain_beats_it():
    big = SQUAD_POINTS + HIT_COST_POINTS + 1
    plan = _plan(_options({16: (big,), 13: (big,)}, horizon=1))
    assert len(_moves(plan)) == 2 and plan.weeks[0].hits == 1

    small = SQUAD_POINTS + HIT_COST_POINTS - 1
    plan = _plan(_options({16: (big,), 13: (small,)}, horizon=1))
    assert _moves(plan) == [(6, 16)] and plan.weeks[0].hits == 0


def test_never_overspends():
    points = {16: (9.0,), 13: (9.0,)}
    plan = _plan(_options(points, horizon=1, price={16: PRICE + 3, 13: PRICE + 3}), bank=4)
    assert len(_moves(plan)) == 1


def test_never_breaks_the_club_limit():
    # Squad players 7 and 8 share club 6 with MID 6, so buying MID 16
    # from club 6 needs one of them sold.
    clubs = {7: 6, 8: 6, 16: 6}
    plan = _plan(_options({16: (9.0,)}, horizon=1, club=clubs))
    (week,) = plan.weeks
    assert sum(1 for p in week.squad if clubs.get(p, p) == 6) <= RULES.max_players_per_team


def test_four_from_one_club_can_be_kept_but_not_added_to():
    clubs = {4: 3, 5: 3, 6: 3, 16: 3}
    plan = _plan(_options({16: (9.0,), 19: (9.0,)}, horizon=1, club=clubs), free_transfers=2)
    assert _moves(plan) == [(9, 19)]

