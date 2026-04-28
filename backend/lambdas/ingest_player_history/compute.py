"""Pure functions for ingest_player_history.

Separated from handler.py so the parsing/serialization logic can be
unit-tested without HTTP or DDB scaffolding.

DDB layout
----------
For each player we write:

- N rows with ``sk = gw#{round:03d}#fixture#{fixture}`` — one per played
  fixture. A double-gameweek yields two rows sharing ``round`` but
  differing in ``fixture`` and ``opponent_team``.
- M rows with ``sk = season_summary#{season_name}`` — one per prior
  season FPL surfaces in ``history_past``.

All rows share ``pk = fpl#player_history#{player_id}``, so a single
``Query`` returns everything we know about one player.

Defcon
------
The 25/26 ``defensive_contribution`` field FPL ships on each history row
is the position-aware count comparable to the FPL threshold:

- DEF: clearances + blocks + interceptions + tackles, threshold ≥ 10
- MID/FWD: CBI + tackles + recoveries, threshold ≥ 12

So ``defensive_contribution >= 10`` (DEF) or ``>= 12`` (MID/FWD)
indicates the +2 defcon bonus triggered. Verified inductively by
inspecting real payloads (Bruno Fernandes / Gabriel Magalhães) at PR
time: dc field equals CBI+T (DEF) or CBI+T+R (MID/FWD).
"""
from __future__ import annotations

from typing import Any

from schemas import PlayerHistory, PlayerHistoryPast, PlayerHistoryRow


def parse_element_summary(payload: dict[str, Any]) -> PlayerHistory:
    """Parse a ``/element-summary/{id}/`` payload into the slice we keep.

    The endpoint also returns an ``fixtures`` array of the player's
    upcoming fixtures; we ignore it because fixtures are kept in the
    canonical ``fpl#fixtures, sk=latest`` row written by the bootstrap
    ingest, and a per-player projection would just duplicate that data
    with a less useful key.
    """
    return PlayerHistory.model_validate(payload)


def player_history_pk(player_id: int) -> str:
    return f"fpl#player_history#{player_id}"


def history_row_sk(row: PlayerHistoryRow) -> str:
    """Sort key for a per-fixture row.

    Includes the fixture id because a DGW yields two rows with the same
    ``round`` but different fixtures. ``round`` is zero-padded to 3
    digits so lexicographic sort matches numeric sort.
    """
    return f"gw#{row.round:03d}#fixture#{row.fixture}"


def history_past_sk(row: PlayerHistoryPast) -> str:
    return f"season_summary#{row.season_name}"


def history_row_to_ddb_item(
    *,
    player_id: int,
    row: PlayerHistoryRow,
    schema_version: int,
    fetched_at: str,
) -> dict[str, Any]:
    return {
        "pk": player_history_pk(player_id),
        "sk": history_row_sk(row),
        "schema_version": schema_version,
        "fetched_at": fetched_at,
        "data": row.model_dump(),
    }


def history_past_to_ddb_item(
    *,
    player_id: int,
    row: PlayerHistoryPast,
    schema_version: int,
    fetched_at: str,
) -> dict[str, Any]:
    return {
        "pk": player_history_pk(player_id),
        "sk": history_past_sk(row),
        "schema_version": schema_version,
        "fetched_at": fetched_at,
        "data": row.model_dump(),
    }
