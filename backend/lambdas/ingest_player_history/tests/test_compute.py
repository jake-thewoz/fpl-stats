from __future__ import annotations

import json
from pathlib import Path

import pytest

from compute import (
    history_past_sk,
    history_past_to_ddb_item,
    history_row_sk,
    history_row_to_ddb_item,
    parse_element_summary,
    player_history_pk,
)
from schemas import PlayerHistoryPast, PlayerHistoryRow

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "element_summary_sample.json"


@pytest.fixture
def sample_payload() -> dict:
    with FIXTURE_PATH.open() as f:
        return json.load(f)


def test_parse_element_summary_returns_history_and_past(sample_payload: dict) -> None:
    parsed = parse_element_summary(sample_payload)
    assert len(parsed.history) == 7
    assert len(parsed.history_past) == 2
    # `fixtures` (upcoming) is intentionally dropped.


def test_parse_extracts_underlying_stats(sample_payload: dict) -> None:
    """xG / xA / xGI / xGC are the keystone v2 inputs — make sure they
    round-trip through the parser intact (FPL ships them as decimal
    strings, not numbers)."""
    parsed = parse_element_summary(sample_payload)
    goals_row = next(r for r in parsed.history if r.goals_scored == 1)
    assert goals_row.expected_goals is not None
    assert goals_row.expected_assists is not None
    # FPL ships ICT components and xG-family as strings; we keep them as
    # strings so the float→Decimal conversion is decided by the consumer.
    assert isinstance(goals_row.expected_goals, str)
    assert isinstance(goals_row.expected_assists, str)


def test_parse_extracts_defcon_components(sample_payload: dict) -> None:
    """The dc field is the position-aware sum FPL pre-computes; for a
    MID (Bruno Fernandes) it should equal CBI+T+R on each row."""
    parsed = parse_element_summary(sample_payload)
    for row in parsed.history:
        if row.minutes == 0:
            continue
        cbit_r = (
            (row.clearances_blocks_interceptions or 0)
            + (row.tackles or 0)
            + (row.recoveries or 0)
        )
        assert row.defensive_contribution == cbit_r, (
            f"round {row.round} fixture {row.fixture}: "
            f"dc={row.defensive_contribution} but CBI+T+R={cbit_r}"
        )


def test_history_row_sk_zero_pads_round() -> None:
    row = _make_history_row(round_=3, fixture=99)
    assert history_row_sk(row) == "gw#003#fixture#99"


def test_history_row_sk_handles_double_gameweek() -> None:
    """Same round, different fixture → distinct sks. This is the
    primary reason fixture id is part of the sk at all."""
    a = _make_history_row(round_=22, fixture=99001)
    b = _make_history_row(round_=22, fixture=99002)
    assert history_row_sk(a) != history_row_sk(b)
    assert history_row_sk(a) == "gw#022#fixture#99001"
    assert history_row_sk(b) == "gw#022#fixture#99002"


def test_history_past_sk_preserves_season_name() -> None:
    past = _make_history_past(season_name="2024/25")
    # FPL season names contain a slash; keeping it raw avoids ambiguity
    # with any escaping a future consumer might apply.
    assert history_past_sk(past) == "season_summary#2024/25"


def test_player_history_pk_is_namespaced() -> None:
    assert player_history_pk(449) == "fpl#player_history#449"


def test_history_row_to_ddb_item_shape() -> None:
    row = _make_history_row(round_=5, fixture=42)
    item = history_row_to_ddb_item(
        player_id=449, row=row, schema_version=1, fetched_at="2026-04-28T12:00:00Z"
    )
    assert item["pk"] == "fpl#player_history#449"
    assert item["sk"] == "gw#005#fixture#42"
    assert item["schema_version"] == 1
    assert item["fetched_at"] == "2026-04-28T12:00:00Z"
    assert item["data"]["round"] == 5
    assert item["data"]["fixture"] == 42


def test_history_past_to_ddb_item_shape() -> None:
    past = _make_history_past(season_name="2024/25")
    item = history_past_to_ddb_item(
        player_id=449, row=past, schema_version=1, fetched_at="2026-04-28T12:00:00Z"
    )
    assert item["pk"] == "fpl#player_history#449"
    assert item["sk"] == "season_summary#2024/25"
    assert item["data"]["season_name"] == "2024/25"


def test_dgw_round_trip_through_ddb_items_yields_distinct_keys() -> None:
    """End-to-end: same round, different fixture → two distinct DDB items
    that survive the put / query round-trip without overwriting each other."""
    a = _make_history_row(round_=22, fixture=99001)
    b = _make_history_row(round_=22, fixture=99002)
    item_a = history_row_to_ddb_item(
        player_id=449, row=a, schema_version=1, fetched_at="t"
    )
    item_b = history_row_to_ddb_item(
        player_id=449, row=b, schema_version=1, fetched_at="t"
    )
    assert (item_a["pk"], item_a["sk"]) != (item_b["pk"], item_b["sk"])


def _make_history_row(*, round_: int, fixture: int) -> PlayerHistoryRow:
    return PlayerHistoryRow(
        element=449,
        fixture=fixture,
        opponent_team=7,
        was_home=True,
        round=round_,
        minutes=90,
        goals_scored=0,
        assists=0,
        clean_sheets=0,
        goals_conceded=1,
        saves=0,
        bonus=0,
        bps=20,
        yellow_cards=0,
        red_cards=0,
        own_goals=0,
        penalties_saved=0,
        penalties_missed=0,
        total_points=2,
    )


def _make_history_past(*, season_name: str) -> PlayerHistoryPast:
    return PlayerHistoryPast(
        season_name=season_name,
        element_code=141746,
        minutes=3000,
        goals_scored=8,
        assists=10,
        clean_sheets=10,
        goals_conceded=40,
        saves=0,
        bonus=20,
        bps=600,
        yellow_cards=3,
        red_cards=0,
        own_goals=0,
        penalties_saved=0,
        penalties_missed=0,
        total_points=170,
    )
