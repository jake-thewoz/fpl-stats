"""Guard helper — is there a live FPL match right now, and when's the next?

Read-only. Uses only the DDB-cached fixtures (pk=fpl#fixtures, sk=latest);
never hits the FPL API.

Intended for Lambdas that want to throttle expensive work during live
match windows (kickoff -> kickoff + 2h). The computation is a pure
function so callers can test their own logic against synthetic fixtures
without mocking DDB.

Decision note
-------------
`is_live` is derived from `kickoff_time` alone — we do not trust the
`started` / `finished` flags on the Fixture model. Those flags can lag
behind real-world state between ingest ticks, so a time-window check is
both simpler and more conservative (we'd rather treat a weather-delayed
match as live and skip heavy work than do the opposite).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from schemas import Fixture

LIVE_WINDOW = timedelta(hours=2)
FIXTURES_PK = "fpl#fixtures"
FIXTURES_SK = "latest"


class FixturesCacheMissing(RuntimeError):
    """Raised when the DDB cache has no fixtures item.

    In practice this only happens before the first ingest run has
    succeeded — callers should treat it as a bootstrapping error rather
    than silently degrading.
    """


@dataclass(frozen=True)
class MatchWindow:
    is_live: bool
    next_kickoff: Optional[datetime]


def _parse_kickoff(raw: Optional[str]) -> Optional[datetime]:
    if raw is None:
        return None
    # FPL emits "2025-08-15T19:00:00Z"; fromisoformat handles the trailing
    # Z on Python 3.11+. Lambda runtime is 3.12, so this is safe.
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def compute_match_window(
    fixtures: Iterable[Fixture],
    now: datetime,
) -> MatchWindow:
    """Pure-function match-window computation over a fixtures list.

    Args:
        fixtures: iterable of Fixture models (typically from the DDB cache).
        now: UTC reference time. Caller is responsible for timezone-awareness.

    Returns:
        MatchWindow(is_live, next_kickoff). `next_kickoff` is None if no
        cached fixture has a kickoff strictly greater than `now`
        (off-season, or all fixtures in the cache are in the past).
    """
    is_live = False
    next_kickoff: Optional[datetime] = None

    for fx in fixtures:
        k = _parse_kickoff(fx.kickoff_time)
        if k is None:
            continue
        if k <= now < k + LIVE_WINDOW:
            is_live = True
        elif k > now and (next_kickoff is None or k < next_kickoff):
            next_kickoff = k

    return MatchWindow(is_live=is_live, next_kickoff=next_kickoff)


def get_match_window(
    table: Any,
    now: Optional[datetime] = None,
) -> MatchWindow:
    """Read the cached fixtures from DDB and evaluate.

    Args:
        table: a boto3 DynamoDB Table resource. Caller owns construction
            (typically `boto3.resource("dynamodb").Table(CACHE_TABLE_NAME)`).
        now: UTC time to evaluate against. Defaults to datetime.now(UTC);
            accept a value for deterministic tests.

    Raises:
        FixturesCacheMissing: if `pk=fpl#fixtures, sk=latest` isn't in DDB.
    """
    resolved_now = now if now is not None else datetime.now(timezone.utc)

    resp = table.get_item(Key={"pk": FIXTURES_PK, "sk": FIXTURES_SK})
    item = resp.get("Item")
    if item is None:
        raise FixturesCacheMissing(
            f"no DDB item at pk={FIXTURES_PK} sk={FIXTURES_SK} — has ingest run yet?"
        )

    fixtures = [Fixture.model_validate(f) for f in item["data"]]
    return compute_match_window(fixtures, resolved_now)
