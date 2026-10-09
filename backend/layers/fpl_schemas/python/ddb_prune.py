"""Delete cached rows that a writer's latest run no longer produces.

Writers in this stack overwrite rows by key, so a key that stops being
produced is never removed on its own. That is how the 2026/27 season
rollover broke the cache: FPL reassigns player ids and fixture ids every
season, so last season's rows stayed behind under ids that now belong
to different players, and readers blended them in as if they were
current.

The fix is to treat each run's output as the complete set for the
partitions it owns: collect the keys that exist before writing, then
delete whichever ones the run didn't write. Whatever the reason a key
disappears (a new season, a player leaving the league, FPL rescheduling
a fixture), the cache follows.

Callers own the safety check: never prune from a run whose inputs were
empty or failed, because "this run wrote nothing" would then delete
everything.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable


def sort_keys_in_partition(table: Any, pk: str) -> set[str]:
    """Every ``sk`` currently stored under one partition key."""
    sort_keys: set[str] = set()
    request: dict[str, Any] = {
        "KeyConditionExpression": "pk = :pk",
        "ExpressionAttributeValues": {":pk": pk},
        "ProjectionExpression": "sk",
    }
    while True:
        page = table.query(**request)
        sort_keys.update(item["sk"] for item in page.get("Items", []))
        last_key = page.get("LastEvaluatedKey")
        if not last_key:
            return sort_keys
        request["ExclusiveStartKey"] = last_key


def sort_keys_by_partition(table: Any, pk_prefix: str) -> dict[str, set[str]]:
    """Every ``(pk, sk)`` whose ``pk`` starts with ``pk_prefix``, grouped by pk.

    Uses a Scan because the partitions to find (e.g. history for players
    who have left the league) aren't known in advance. Scans read the
    whole table, so only call this from scheduled jobs, never on the
    request path.
    """
    sort_keys_by_pk: dict[str, set[str]] = defaultdict(set)
    request: dict[str, Any] = {
        "FilterExpression": "begins_with(pk, :prefix)",
        "ExpressionAttributeValues": {":prefix": pk_prefix},
        "ProjectionExpression": "pk, sk",
    }
    while True:
        page = table.scan(**request)
        for item in page.get("Items", []):
            sort_keys_by_pk[item["pk"]].add(item["sk"])
        last_key = page.get("LastEvaluatedKey")
        if not last_key:
            return dict(sort_keys_by_pk)
        request["ExclusiveStartKey"] = last_key


def prune_partition(
    batch: Any,
    pk: str,
    existing_sort_keys: Iterable[str],
    current_sort_keys: set[str],
) -> int:
    """Queue a delete for every existing ``sk`` not in ``current_sort_keys``.

    ``batch`` is a ``table.batch_writer()``. The keys deleted here are by
    definition ones this run didn't put, so the same batch can't receive
    both a put and a delete for one key (which DynamoDB rejects).
    Returns the number of rows deleted.
    """
    stale_sort_keys = sorted(set(existing_sort_keys) - current_sort_keys)
    for sort_key in stale_sort_keys:
        batch.delete_item(Key={"pk": pk, "sk": sort_key})
    return len(stale_sort_keys)
