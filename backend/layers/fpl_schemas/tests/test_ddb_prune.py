from __future__ import annotations

from unittest.mock import MagicMock

from ddb_prune import prune_partition, sort_keys_by_partition, sort_keys_in_partition


def _paged(pages: list[list[dict]]) -> MagicMock:
    """A query/scan mock that serves ``pages`` in order, linking them with
    LastEvaluatedKey the way DynamoDB does."""
    responses = []
    for index, items in enumerate(pages):
        response: dict = {"Items": items}
        if index < len(pages) - 1:
            response["LastEvaluatedKey"] = {"page": index}
        responses.append(response)
    return MagicMock(side_effect=responses)


def test_sort_keys_in_partition_follows_pagination() -> None:
    table = MagicMock()
    table.query = _paged([[{"sk": "1"}, {"sk": "2"}], [{"sk": "3"}]])

    assert sort_keys_in_partition(table, "analytics#player_form") == {"1", "2", "3"}
    second_call = table.query.call_args_list[1].kwargs
    assert second_call["ExclusiveStartKey"] == {"page": 0}
    assert second_call["ExpressionAttributeValues"] == {":pk": "analytics#player_form"}


def test_sort_keys_by_partition_groups_and_follows_pagination() -> None:
    table = MagicMock()
    table.scan = _paged([
        [{"pk": "fpl#player_history#1", "sk": "gw#001#fixture#1"}],
        [
            {"pk": "fpl#player_history#1", "sk": "gw#002#fixture#12"},
            {"pk": "fpl#player_history#900", "sk": "gw#038#fixture#380"},
        ],
    ])

    result = sort_keys_by_partition(table, "fpl#player_history#")

    assert result == {
        "fpl#player_history#1": {"gw#001#fixture#1", "gw#002#fixture#12"},
        "fpl#player_history#900": {"gw#038#fixture#380"},
    }
    assert table.scan.call_args_list[0].kwargs["ExpressionAttributeValues"] == {
        ":prefix": "fpl#player_history#"
    }


def test_sort_keys_by_partition_empty_table() -> None:
    table = MagicMock()
    table.scan = _paged([[]])

    assert sort_keys_by_partition(table, "fpl#player_history#") == {}


def test_prune_partition_deletes_only_keys_not_written_this_run() -> None:
    batch = MagicMock()

    deleted = prune_partition(
        batch,
        "fpl#player_history#7",
        existing_sort_keys={"gw#001#fixture#1", "gw#001#fixture#9", "gw#030#fixture#300"},
        current_sort_keys={"gw#001#fixture#1"},
    )

    assert deleted == 2
    deleted_keys = [c.kwargs["Key"] for c in batch.delete_item.call_args_list]
    assert deleted_keys == [
        {"pk": "fpl#player_history#7", "sk": "gw#001#fixture#9"},
        {"pk": "fpl#player_history#7", "sk": "gw#030#fixture#300"},
    ]


def test_prune_partition_with_empty_current_set_clears_partition() -> None:
    batch = MagicMock()

    deleted = prune_partition(batch, "fpl#player_history#900", {"a", "b"}, set())

    assert deleted == 2


def test_prune_partition_noop_when_nothing_stale() -> None:
    batch = MagicMock()

    assert prune_partition(batch, "pk", {"a"}, {"a", "b"}) == 0
    batch.delete_item.assert_not_called()
