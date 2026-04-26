from __future__ import annotations

import json
import os
from decimal import Decimal
from unittest.mock import MagicMock, patch

import boto3
import pytest
import responses
from moto import mock_aws

os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")
os.environ.setdefault("SNAPSHOTS_BUCKET_NAME", "test-snapshots-bucket")

import handler  # noqa: E402
from handler import CLUBELO_BASE_URL, lambda_handler  # noqa: E402


# ---------------------------------------------------------------------------
# Hand-built fixtures — small CSV + bootstrap with a few PL clubs covering:
#   - clubs in the mapping AND in the CSV (should land in DDB)
#   - clubs in the mapping but NOT in the CSV (should land in `missing`)
#   - CSV rows for non-PL clubs (Real Madrid etc.) — must be ignored
#   - bootstrap teams not in the mapping (should land in `missing`)
# ---------------------------------------------------------------------------

# Real format from ClubELO's date endpoint. Some plausible 2026 numbers.
SAMPLE_CSV = """\
Rank,Club,Country,Level,Elo,From,To
1,RealMadrid,ESP,1,2110.0,2026-04-26,2026-04-30
2,ManCity,ENG,1,2050.5,2026-04-26,2026-04-30
3,Liverpool,ENG,1,1985.2,2026-04-26,2026-04-30
4,Arsenal,ENG,1,1970.0,2026-04-26,2026-04-30
5,Bournemouth,ENG,1,1750.3,2026-04-26,2026-04-30
6,Tottenham,ENG,1,1830.7,2026-04-26,2026-04-30
"""

BOOTSTRAP_DATA = {
    "teams": [
        {"id": 1, "name": "Arsenal", "short_name": "ARS", "code": 3, "strength": 4},
        {"id": 2, "name": "Bournemouth", "short_name": "BOU", "code": 91, "strength": 3},
        {"id": 13, "name": "Man City", "short_name": "MCI", "code": 43, "strength": 5},
        {"id": 16, "name": "Tottenham", "short_name": "TOT", "code": 6, "strength": 4},
        # In the CSV but with a club ClubELO doesn't have rated yet:
        {"id": 18, "name": "Wolves", "short_name": "WOL", "code": 39, "strength": 3},
        # NOT in our mapping at all (a fictional next-season promoted side):
        {"id": 99, "name": "MadeUp FC", "short_name": "MFC", "code": 999, "strength": 2},
    ],
    "positions": [
        {"id": 1, "singular_name": "Goalkeeper", "singular_name_short": "GKP"},
    ],
    "players": [],
    "gameweeks": [],
}


def _bootstrap_item():
    return {
        "Item": {
            "pk": "fpl#bootstrap",
            "sk": "latest",
            "data": BOOTSTRAP_DATA,
        }
    }


@pytest.fixture
def s3_bucket():
    """Real moto-mocked S3 so we can actually inspect what was written
    (matches the ingest_fpl test layout)."""
    with mock_aws():
        s3 = boto3.client("s3", region_name="us-east-1")
        s3.create_bucket(Bucket="test-snapshots-bucket")
        yield s3


@pytest.fixture
def mock_ddb():
    """MagicMock'd DDB — we don't need real DDB semantics to assert
    on the put_item payload."""
    table = MagicMock()
    table.get_item.return_value = _bootstrap_item()

    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table


@pytest.fixture
def no_retry_session(monkeypatch):
    """Strip retries so error tests don't wait on exponential backoff."""
    import requests
    monkeypatch.setattr(handler, "make_fpl_session", requests.Session)


def _csv_url_for_today():
    """Fixed today URL the handler will hit — `responses` matches by URL."""
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"{CLUBELO_BASE_URL}/{today}"


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@responses.activate
def test_happy_path_writes_filtered_ratings_to_ddb(
    s3_bucket, mock_ddb, no_retry_session,
):
    """5 teams in bootstrap; 4 in CSV; 1 in mapping but not CSV; 1 not in
    mapping. Expect 4 entries in DDB ratings, 2 in missing."""
    responses.get(_csv_url_for_today(), body=SAMPLE_CSV)

    result = lambda_handler({}, None)

    assert result["ok"] is True
    assert result["teams_with_elo"] == 4
    assert len(result["missing"]) == 2

    ddb_call = mock_ddb.put_item.call_args
    assert ddb_call is not None
    item = ddb_call.kwargs["Item"]
    assert item["pk"] == "clubelo#ratings"
    assert item["sk"] == "latest"

    ratings = item["ratings"]
    assert ratings["1"] == Decimal("1970")     # Arsenal
    assert ratings["2"] == Decimal("1750.3")   # Bournemouth
    assert ratings["13"] == Decimal("2050.5")  # Man City
    assert ratings["16"] == Decimal("1830.7")  # Tottenham
    # Wolves: in mapping but no CSV row -> not in ratings.
    assert "18" not in ratings
    # MadeUp FC: not in mapping -> not in ratings.
    assert "99" not in ratings


@responses.activate
def test_happy_path_archives_raw_csv_to_s3(
    s3_bucket, mock_ddb, no_retry_session,
):
    """The raw CSV should land in S3 unchanged for replay/history."""
    responses.get(_csv_url_for_today(), body=SAMPLE_CSV)

    result = lambda_handler({}, None)

    keys = [
        obj["Key"]
        for obj in s3_bucket.list_objects_v2(
            Bucket="test-snapshots-bucket"
        ).get("Contents", [])
    ]
    assert len(keys) == 1
    assert keys[0].startswith("clubelo/ratings/")
    assert keys[0].endswith(".csv")
    assert keys[0].split("/")[-1].replace(".csv", "") == result["snapshot_id"]

    body = s3_bucket.get_object(
        Bucket="test-snapshots-bucket", Key=keys[0]
    )["Body"].read().decode("utf-8")
    assert body == SAMPLE_CSV


@responses.activate
def test_writes_decimal_not_float(
    s3_bucket, mock_ddb, no_retry_session,
):
    """DDB resource API rejects float; ratings must be Decimal so the
    existing analyzer reads round-trip cleanly."""
    responses.get(_csv_url_for_today(), body=SAMPLE_CSV)

    lambda_handler({}, None)

    item = mock_ddb.put_item.call_args.kwargs["Item"]
    for elo in item["ratings"].values():
        assert isinstance(elo, Decimal)


@responses.activate
def test_missing_list_includes_unmapped_short_names(
    s3_bucket, mock_ddb, no_retry_session,
):
    """The MadeUp FC entry isn't in our static mapping — surface it in
    the response so future runs of this Lambda + log inspection make it
    obvious that the mapping needs updating (e.g. promoted club)."""
    responses.get(_csv_url_for_today(), body=SAMPLE_CSV)

    result = lambda_handler({}, None)

    missing_str = " ".join(result["missing"])
    assert "MFC" in missing_str
    assert "WOL" in missing_str  # in mapping, but no CSV row


# ---------------------------------------------------------------------------
# CSV edge cases
# ---------------------------------------------------------------------------


@responses.activate
def test_csv_with_unparseable_row_skips_it(
    s3_bucket, mock_ddb, no_retry_session,
):
    """One malformed row shouldn't kill the whole run."""
    bad_csv = (
        "Rank,Club,Country,Level,Elo,From,To\n"
        "1,Arsenal,ENG,1,1970.0,2026-04-26,2026-04-30\n"
        "2,ManCity,ENG,1,not-a-number,2026-04-26,2026-04-30\n"
        "3,Tottenham,ENG,1,1830.7,2026-04-26,2026-04-30\n"
    )
    responses.get(_csv_url_for_today(), body=bad_csv)

    result = lambda_handler({}, None)
    assert result["ok"] is True

    ratings = mock_ddb.put_item.call_args.kwargs["Item"]["ratings"]
    assert "1" in ratings  # Arsenal got through
    assert "16" in ratings  # Tottenham got through
    assert "13" not in ratings  # Man City was unparseable


@responses.activate
def test_empty_csv_writes_empty_ratings_with_all_missing(
    s3_bucket, mock_ddb, no_retry_session,
):
    """Pre-season race: ClubELO's date endpoint may briefly return only
    headers. Don't crash — just log every team as missing and write an
    empty ratings map. The form analyzer's graceful-degradation path
    keeps working until the next day's run."""
    empty_csv = "Rank,Club,Country,Level,Elo,From,To\n"
    responses.get(_csv_url_for_today(), body=empty_csv)

    result = lambda_handler({}, None)
    assert result["ok"] is True
    assert result["teams_with_elo"] == 0
    assert len(result["missing"]) == 6  # all six bootstrap teams

    item = mock_ddb.put_item.call_args.kwargs["Item"]
    assert item["ratings"] == {}


# ---------------------------------------------------------------------------
# Failure paths
# ---------------------------------------------------------------------------


@responses.activate
def test_missing_bootstrap_raises(
    s3_bucket, mock_ddb, no_retry_session,
):
    """Without bootstrap we can't translate ClubELO names to FPL ids —
    raise loudly so on-call sees the dependency broke. Note the S3 archive
    is *already written* by this point — we keep the raw data even on
    DDB-side failure (same invariant as ingest_fpl: S3 first)."""
    responses.get(_csv_url_for_today(), body=SAMPLE_CSV)
    mock_ddb.get_item.return_value = {}

    with pytest.raises(RuntimeError, match="fpl#bootstrap"):
        lambda_handler({}, None)

    # No DDB write attempted.
    mock_ddb.put_item.assert_not_called()


@responses.activate
def test_clubelo_5xx_propagates_after_retries(
    s3_bucket, mock_ddb, no_retry_session,
):
    """Surface upstream outages — we don't want to write a stale 'fresh'
    row in DDB when the upstream actually failed."""
    import requests
    responses.get(_csv_url_for_today(), status=503)

    with pytest.raises(requests.HTTPError):
        lambda_handler({}, None)

    mock_ddb.put_item.assert_not_called()


# ---------------------------------------------------------------------------
# Mapping file integrity (fast canary; full re-curation each season)
# ---------------------------------------------------------------------------


def test_mapping_file_loads_as_object_with_strings():
    """team_mapping.json must be a flat string -> string object."""
    mapping = handler._load_mapping()
    assert isinstance(mapping, dict)
    assert all(isinstance(k, str) and isinstance(v, str)
               for k, v in mapping.items())


def test_mapping_keys_are_three_letter_short_names():
    """Sanity: short_names are 3 chars uppercase, like FPL's data."""
    mapping = handler._load_mapping()
    for short_name in mapping:
        assert len(short_name) == 3, f"bad key: {short_name!r}"
        assert short_name.isupper(), f"non-upper key: {short_name!r}"


def test_mapping_has_no_duplicate_clubelo_values():
    """Two FPL teams pointing to one ClubELO name would silently collide
    in the lookup. The reverse map must be 1:1."""
    mapping = handler._load_mapping()
    values = list(mapping.values())
    assert len(values) == len(set(values)), \
        f"duplicate ClubELO names in mapping: {values}"
