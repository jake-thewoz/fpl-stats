"""Save the injury-flag and price history held in the S3 bootstrap
snapshots before the bucket's 90-day lifecycle rule deletes it (#245).

Reads every ``fpl/bootstrap-static/*.json`` snapshot and writes only the
changes: one JSON line per player whose tracked fields differ from the
previous snapshot, plus each snapshot's time. Re-running merges with
the existing archive, so snapshots that have since expired are kept.

Usage
-----
    cd backend/scripts
    source .venv/bin/activate
    python3 spikes/archive_flag_history.py

Writes ``spikes/flag_history/changes.jsonl.gz`` (gitignored).
"""
from __future__ import annotations

import gzip
import json
import logging
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import boto3
from botocore.config import Config

_SCRIPTS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(_SCRIPTS_DIR.parent / "layers" / "fpl_schemas" / "python"))
sys.path.insert(0, str(_SCRIPTS_DIR))

from data import stack_output  # noqa: E402
from flag_history import CHANGE_LOG_PATH  # noqa: E402

SNAPSHOT_PREFIX = "fpl/bootstrap-static/"
BUCKET_OUTPUT_KEY = "SnapshotsBucketName"
TRACKED_FIELDS = (
    "status", "chance_of_playing_this_round", "chance_of_playing_next_round",
    "news", "news_added", "now_cost", "team",
)
DOWNLOAD_WORKERS = 16

log = logging.getLogger(__name__)


def _snapshot_time(key: str) -> str:
    return key.removeprefix(SNAPSHOT_PREFIX).removesuffix(".json")


def _tracked(s3, bucket: str, key: str) -> dict[int, dict]:
    body = json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
    return {e["id"]: {f: e.get(f) for f in TRACKED_FIELDS} for e in body["elements"]}


def _read_existing() -> dict[str, dict[int, dict]]:
    """snapshot time -> {player_id: changed fields} from an earlier run."""
    changes: dict[str, dict[int, dict]] = {}
    if CHANGE_LOG_PATH.exists():
        with gzip.open(CHANGE_LOG_PATH, "rt") as handle:
            for line in handle:
                row = json.loads(line)
                snapshot_changes = changes.setdefault(row["snapshot"], {})
                if row["player_id"] is not None:
                    snapshot_changes[row["player_id"]] = row["fields"]
    return changes


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    s3 = boto3.client("s3", config=Config(max_pool_connections=DOWNLOAD_WORKERS))
    bucket = stack_output(BUCKET_OUTPUT_KEY)
    keys = sorted(
        obj["Key"]
        for page in s3.get_paginator("list_objects_v2").paginate(
            Bucket=bucket, Prefix=SNAPSHOT_PREFIX)
        for obj in page.get("Contents", [])
    )
    existing = _read_existing()
    keys = [k for k in keys if _snapshot_time(k) not in existing]
    log.info("%d new snapshots to read (%d already archived)", len(keys), len(existing))

    with ThreadPoolExecutor(DOWNLOAD_WORKERS) as pool:
        states = list(pool.map(lambda key: _tracked(s3, bucket, key), keys))

    # Rebuild the latest archived state so new snapshots diff against it.
    state: dict[int, dict] = {}
    merged = dict(existing)
    for snapshot in sorted(existing):
        for player_id, fields in existing[snapshot].items():
            state.setdefault(player_id, {}).update(fields)
    for key, snapshot_state in zip(keys, states):
        changed = {}
        for player_id, fields in snapshot_state.items():
            diff = {f: v for f, v in fields.items() if state.get(player_id, {}).get(f) != v}
            if diff:
                changed[player_id] = diff
                state.setdefault(player_id, {}).update(diff)
        merged[_snapshot_time(key)] = changed

    CHANGE_LOG_PATH.parent.mkdir(exist_ok=True)
    with gzip.open(CHANGE_LOG_PATH, "wt") as handle:
        for snapshot in sorted(merged):
            # A row with player_id null marks a snapshot with no changes.
            if not merged[snapshot]:
                handle.write(json.dumps({"snapshot": snapshot, "player_id": None,
                                         "fields": {}}) + "\n")
            for player_id, fields in sorted(merged[snapshot].items()):
                handle.write(json.dumps({"snapshot": snapshot, "player_id": player_id,
                                         "fields": fields}) + "\n")
    log.info("Wrote %s: %d snapshots", CHANGE_LOG_PATH, len(merged))
    return 0


if __name__ == "__main__":
    sys.exit(main())
