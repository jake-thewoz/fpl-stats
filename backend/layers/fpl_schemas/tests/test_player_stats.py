from __future__ import annotations

import json

import pytest

from schemas import PLAYER_STATS_FIELDS, PlayerStats, player_stats_columns

# Real /bootstrap-static/ element (GW6 2026/27), trimmed to the stats fields
# plus a few that PlayerStats should ignore.
HAALAND_RAW = {
    "id": 411, "web_name": "Haaland", "now_cost": 145, "status": "a",
    "event_points": 6, "dreamteam_count": 2, "goals_conceded": 5, "own_goals": 0,
    "penalties_saved": 0, "penalties_missed": 0, "yellow_cards": 0, "red_cards": 0,
    "saves": 0, "starts": 6, "tackles": 1, "clearances_blocks_interceptions": 13,
    "recoveries": 11, "transfers_in": 1064367, "transfers_out": 363090,
    "transfers_in_event": 37841, "transfers_out_event": 3147,
    "expected_goal_involvements": "5.12", "expected_goals_conceded": "8.04",
    "influence": "184.2", "creativity": "22.5", "threat": "258.0",
    "value_form": "0.4", "value_season": "2.9", "ep_next": "7.0",
    "expected_goals_per_90": 0.78, "expected_assists_per_90": 0.09,
    "expected_goal_involvements_per_90": 0.87, "expected_goals_conceded_per_90": 1.37,
    "saves_per_90": 0.0, "goals_conceded_per_90": 0.85, "clean_sheets_per_90": 0.51,
    "starts_per_90": 1.02, "cost_change_start": -3,
}

# Wire-format budget for the whole fpl#player_stats item. DynamoDB caps an
# item at 400 KB; the margin covers the item's other attributes and
# DynamoDB's own encoding overhead.
MAX_STATS_JSON_BYTES = 350_000
REALISTIC_PLAYER_COUNT = 700


def test_has_all_34_stats():
    assert len(PLAYER_STATS_FIELDS) == 34
    assert "id" not in PLAYER_STATS_FIELDS


def test_parses_real_element_into_wire_units():
    values = PlayerStats.model_validate(HAALAND_RAW).wire_values()
    assert values["expected_goal_involvements"] == pytest.approx(5.12)
    assert values["ep_next"] == pytest.approx(7.0)
    assert values["transfers_in"] == 1064367
    assert values["saves_per_90"] == 0.0
    # 0.1m units -> £m, like cost_change_event on /players.
    assert values["cost_change_start"] == pytest.approx(-0.3)
    assert "now_cost" not in values and "id" not in values


def test_unparseable_numeric_string_becomes_none():
    stats = PlayerStats.model_validate({**HAALAND_RAW, "influence": "n/a"})
    assert stats.influence is None
    assert stats.creativity == pytest.approx(22.5)


def test_missing_fields_default_to_none():
    values = PlayerStats.model_validate({"id": 1}).wire_values()
    assert set(values) == set(PLAYER_STATS_FIELDS)
    assert all(v is None for v in values.values())


def test_columns_align_with_ids():
    players = [
        PlayerStats.model_validate(HAALAND_RAW),
        PlayerStats.model_validate({**HAALAND_RAW, "id": 1, "saves": 13}),
    ]
    columns = player_stats_columns(players)
    assert columns["ids"] == [411, 1]
    assert columns["stats"]["saves"] == [0, 13]
    assert set(columns["stats"]) == set(PLAYER_STATS_FIELDS)


def test_full_season_payload_fits_one_dynamodb_item():
    players = [
        PlayerStats.model_validate({**HAALAND_RAW, "id": 10_000 + i})
        for i in range(REALISTIC_PLAYER_COUNT)
    ]
    size = len(json.dumps(player_stats_columns(players)))
    assert size < MAX_STATS_JSON_BYTES, size
