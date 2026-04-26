"""Scheduled ClubELO ingestion Lambda.

Once a day fetches ClubELO's date endpoint (CSV of every European club's
ELO for that date), archives the raw CSV to S3, filters to PL clubs via
the static ``team_mapping.json``, and caches a parsed map keyed by FPL
team id at ``clubelo#ratings, sk=latest``.

ClubELO publishes ratings recomputed daily; we fetch in the early-morning
quiet window (03:00 UTC) so the form analyzer's 04:00 run has fresh
data. Reuses ``make_fpl_session`` for the User-Agent + retry policy
even though ClubELO is friendlier than FPL — consistency means a future
filter on their side doesn't surprise us.

Note: ClubELO's API is HTTP, not HTTPS — they don't publish a TLS
endpoint as of writing.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import boto3

from fpl_session import make_fpl_session
from schemas import SCHEMA_VERSION, Bootstrap

log = logging.getLogger()
log.setLevel(logging.INFO)

CLUBELO_BASE_URL = "http://api.clubelo.com"
HTTP_TIMEOUT_SECONDS = 10

# S3 layout mirrors ingest_fpl: clubelo/ratings/<URL-friendly-ISO>.csv
S3_PREFIX = "clubelo/ratings"

LAMBDA_DIR = Path(__file__).parent
MAPPING_FILE = LAMBDA_DIR / "team_mapping.json"


def _load_mapping() -> dict[str, str]:
    """{fpl_short_name: clubelo_name} from the bundled JSON.

    Keyed by FPL ``short_name`` (3-letter code, stable within a season,
    survives club renames better than the long name) so the mapping
    update at season turnover is just swapping a few entries.
    """
    with MAPPING_FILE.open() as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise RuntimeError(f"team_mapping.json must be an object, got {type(data)}")
    return data


def _snapshot_id(now: datetime) -> str:
    """URL-friendly ISO-8601 timestamp for the S3 key (matches ingest_fpl)."""
    return now.strftime("%Y-%m-%dT%H-%M-%SZ")


def _today_path(now: datetime) -> str:
    """ClubELO date endpoint expects YYYY-MM-DD."""
    return now.strftime("%Y-%m-%d")


def _fetch_csv(session, date_str: str) -> str:
    url = f"{CLUBELO_BASE_URL}/{date_str}"
    response = session.get(url, timeout=HTTP_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.text


def _parse_csv(csv_text: str) -> dict[str, float]:
    """Parse {clubelo_name: elo} from CSV. Skips rows missing required
    fields rather than failing the whole run — ClubELO occasionally
    publishes incomplete rows for recently-added clubs."""
    reader = csv.DictReader(io.StringIO(csv_text))
    out: dict[str, float] = {}
    for row in reader:
        club = row.get("Club")
        elo_raw = row.get("Elo")
        if not club or not elo_raw:
            continue
        try:
            out[club] = float(elo_raw)
        except ValueError:
            log.warning("Unparseable ELO row, skipping: %r", row)
    return out


def _to_ddb_number(value: float) -> Decimal:
    """DDB resource API rejects raw floats — round + cast to Decimal."""
    return Decimal(str(round(value, 2)))


def _read_bootstrap_teams(table: Any):
    item = table.get_item(
        Key={"pk": "fpl#bootstrap", "sk": "latest"}
    ).get("Item")
    if not item:
        raise RuntimeError("fpl#bootstrap / latest missing — has ingest_fpl run?")
    return Bootstrap.model_validate(item["data"]).teams


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    table_name = os.environ["CACHE_TABLE_NAME"]
    bucket_name = os.environ["SNAPSHOTS_BUCKET_NAME"]
    now = datetime.now(timezone.utc)

    session = make_fpl_session()
    csv_text = _fetch_csv(session, _today_path(now))

    snapshot_id = _snapshot_id(now)
    s3 = boto3.client("s3")
    s3.put_object(
        Bucket=bucket_name,
        Key=f"{S3_PREFIX}/{snapshot_id}.csv",
        Body=csv_text.encode("utf-8"),
        ContentType="text/csv",
    )

    elo_by_clubelo_name = _parse_csv(csv_text)

    table = boto3.resource("dynamodb").Table(table_name)
    teams = _read_bootstrap_teams(table)
    mapping = _load_mapping()

    elo_by_fpl_id: dict[str, Decimal] = {}
    missing: list[str] = []
    for team in teams:
        clubelo_name = mapping.get(team.short_name)
        if clubelo_name is None:
            missing.append(f"no mapping for {team.short_name} ({team.name})")
            continue
        elo = elo_by_clubelo_name.get(clubelo_name)
        if elo is None:
            missing.append(
                f"{team.short_name} -> {clubelo_name} not in ClubELO response"
            )
            continue
        # DDB map keys must be strings — team_id stringified at write time,
        # consumers do the int round-trip.
        elo_by_fpl_id[str(team.id)] = _to_ddb_number(elo)

    if missing:
        log.warning("ELO not resolved for %d team(s): %s", len(missing), missing)

    fetched_at = now.isoformat()
    table.put_item(
        Item={
            "pk": "clubelo#ratings",
            "sk": "latest",
            "schema_version": SCHEMA_VERSION,
            "fetched_at": fetched_at,
            "ratings": elo_by_fpl_id,
        }
    )

    log.info(
        "ClubELO ingestion complete: snapshot=%s teams=%d missing=%d",
        snapshot_id,
        len(elo_by_fpl_id),
        len(missing),
    )
    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "fetched_at": fetched_at,
        "snapshot_id": snapshot_id,
        "teams_with_elo": len(elo_by_fpl_id),
        "missing": missing,
    }
