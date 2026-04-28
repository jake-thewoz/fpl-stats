"""One-off cleanup — batch-delete the legacy ``analytics#player_xp`` rows.

The v1 analyzer Lambda was retired in #118-followup. Its ~700 per-player
DDB rows still live at ``pk=analytics#player_xp`` in the cache table —
no longer read by anything, but they take up listing-tool noise. This
script removes them.

Run once after the v1-retirement PR deploys. Idempotent: a second run
finds no rows and exits cleanly.

Usage
-----
    cd backend/scripts
    source .venv/bin/activate                  # reuse the venv from fit_xp_v2.py
    python3 delete_v1_xp_rows.py --table-name <CacheTableName>

The table name is from the CFN output ``CacheTableName``:

    aws cloudformation describe-stacks --stack-name FplStatsStack \\
        --query 'Stacks[0].Outputs[?OutputKey==`CacheTableName`].OutputValue' \\
        --output text
"""
from __future__ import annotations

import argparse
import logging
import sys
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

log = logging.getLogger(__name__)


_LEGACY_PARTITION = "analytics#player_xp"


def list_legacy_rows(table: Any) -> list[tuple[str, str]]:
    """Return ``[(pk, sk)]`` for every legacy v1 xp row, paginated.

    Uses Query (single-partition) rather than Scan so we read exactly
    the items we care about, no waste."""
    keys: list[tuple[str, str]] = []
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("pk").eq(_LEGACY_PARTITION),
        "ProjectionExpression": "pk, sk",
    }
    while True:
        response = table.query(**kwargs)
        for item in response.get("Items", []):
            keys.append((item["pk"], item["sk"]))
        if "LastEvaluatedKey" not in response:
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    return keys


def batch_delete(table: Any, keys: list[tuple[str, str]]) -> int:
    """Delete every (pk, sk) pair via batch_writer (handles 25-item
    batching + unprocessed-item retry internally). Returns the count
    deleted."""
    deleted = 0
    with table.batch_writer() as batch:
        for pk, sk in keys:
            batch.delete_item(Key={"pk": pk, "sk": sk})
            deleted += 1
    return deleted


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--table-name", required=True,
                        help="DynamoDB cache table name.")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--dry-run", action="store_true",
                        help="List the rows that would be deleted; don't delete.")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    table = boto3.resource("dynamodb", region_name=args.region).Table(args.table_name)

    log.info("Listing legacy %s rows…", _LEGACY_PARTITION)
    keys = list_legacy_rows(table)
    log.info("Found %d rows", len(keys))

    if not keys:
        log.info("Nothing to delete. Exiting.")
        return 0

    if args.dry_run:
        log.info("Dry run — sample of rows that would be deleted:")
        for pk, sk in keys[:5]:
            log.info("  pk=%s  sk=%s", pk, sk)
        if len(keys) > 5:
            log.info("  …and %d more", len(keys) - 5)
        return 0

    deleted = batch_delete(table, keys)
    log.info("Deleted %d rows from %s", deleted, _LEGACY_PARTITION)
    return 0


if __name__ == "__main__":
    sys.exit(main())
