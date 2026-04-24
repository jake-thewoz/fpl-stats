from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from match_window import (
    LIVE_WINDOW,
    FixturesCacheMissing,
    compute_match_window,
    get_match_window,
)
from schemas import Fixture


# Fixed reference point for the parametrized cases. Mid-afternoon UTC on
# a Sunday in March — gameweek-ish time without DST ambiguity.
NOW = datetime(2026, 3, 1, 15, 0, 0, tzinfo=timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _fx(id_: int, kickoff: datetime | None) -> Fixture:
    return Fixture(
        id=id_,
        kickoff_time=None if kickoff is None else _iso(kickoff),
        team_h=1,
        team_a=2,
        finished=False,
        started=False,
    )


@pytest.mark.parametrize(
    "label, fixtures, expected_is_live, expected_next_offset",
    [
        (
            "no fixtures cached",
            [],
            False,
            None,
        ),
        (
            "kickoff exactly now is live",
            [_fx(1, NOW)],
            True,
            None,
        ),
        (
            "kickoff 90 min ago is still live (inside 2h window)",
            [_fx(1, NOW - timedelta(minutes=90))],
            True,
            None,
        ),
        (
            "kickoff exactly 2h ago is no longer live (upper bound exclusive)",
            [_fx(1, NOW - LIVE_WINDOW)],
            False,
            None,
        ),
        (
            "kickoff 3h ago, nothing upcoming",
            [_fx(1, NOW - timedelta(hours=3))],
            False,
            None,
        ),
        (
            "past fixture plus future fixture: not live, next set",
            [
                _fx(1, NOW - timedelta(hours=3)),
                _fx(2, NOW + timedelta(hours=4)),
            ],
            False,
            timedelta(hours=4),
        ),
        (
            "multiple upcoming returns the soonest",
            [
                _fx(1, NOW + timedelta(days=1)),
                _fx(2, NOW + timedelta(hours=5)),
                _fx(3, NOW + timedelta(hours=20)),
            ],
            False,
            timedelta(hours=5),
        ),
        (
            "live plus future: is_live True and next_kickoff still populated",
            [
                _fx(1, NOW),
                _fx(2, NOW + timedelta(hours=6)),
            ],
            True,
            timedelta(hours=6),
        ),
        (
            "TBD fixture (null kickoff) is skipped",
            [
                _fx(1, None),
                _fx(2, NOW + timedelta(hours=2)),
            ],
            False,
            timedelta(hours=2),
        ),
        (
            "kickoff 1 second in the future is not live yet (lower bound inclusive at k)",
            [_fx(1, NOW + timedelta(seconds=1))],
            False,
            timedelta(seconds=1),
        ),
    ],
)
def test_compute_match_window(
    label: str,
    fixtures: list[Fixture],
    expected_is_live: bool,
    expected_next_offset: timedelta | None,
) -> None:
    result = compute_match_window(fixtures, NOW)
    assert result.is_live is expected_is_live, label
    if expected_next_offset is None:
        assert result.next_kickoff is None, label
    else:
        assert result.next_kickoff == NOW + expected_next_offset, label


def test_get_match_window_reads_ddb_cache():
    fixture = _fx(1, NOW + timedelta(hours=3))
    table = MagicMock()
    table.get_item.return_value = {
        "Item": {
            "pk": "fpl#fixtures",
            "sk": "latest",
            "data": [fixture.model_dump()],
        }
    }

    result = get_match_window(table, now=NOW)

    assert result.is_live is False
    assert result.next_kickoff == NOW + timedelta(hours=3)
    table.get_item.assert_called_once_with(
        Key={"pk": "fpl#fixtures", "sk": "latest"}
    )


def test_get_match_window_raises_when_cache_empty():
    table = MagicMock()
    table.get_item.return_value = {}  # no "Item" key — classic DDB miss shape

    with pytest.raises(FixturesCacheMissing):
        get_match_window(table, now=NOW)
