from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import boto3
import pytest
import requests
import responses
from moto import mock_aws

# Moto refuses to run unless AWS creds are set to *something*. Use the
# canonical test dummies so pytest works in a clean shell.
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("CACHE_TABLE_NAME", "test-cache-table")
os.environ.setdefault("SNAPSHOTS_BUCKET_NAME", "test-snapshots-bucket")

import handler  # noqa: E402
from handler import BOOTSTRAP_URL, FIXTURES_URL, lambda_handler  # noqa: E402
from schemas import SCHEMA_VERSION  # noqa: E402


BUCKET_NAME = os.environ["SNAPSHOTS_BUCKET_NAME"]

BOOTSTRAP_PAYLOAD = {
    "teams": [
        {"id": 1, "name": "Arsenal", "short_name": "ARS", "code": 3},
        {"id": 2, "name": "Aston Villa", "short_name": "AVL", "code": 7},
    ],
    "element_types": [
        {"id": 1, "singular_name": "Goalkeeper", "singular_name_short": "GKP"},
        {"id": 3, "singular_name": "Midfielder", "singular_name_short": "MID"},
    ],
    "elements": [
        {
            "id": 1,
            "first_name": "Bukayo",
            "second_name": "Saka",
            "web_name": "Saka",
            "team": 1,
            "element_type": 3,
            "total_points": 120,
            "form": "5.2",
            "now_cost": 90,
        },
    ],
    "events": [
        {
            "id": 1,
            "name": "Gameweek 1",
            "deadline_time": "2025-08-15T17:30:00Z",
            "is_current": True,
            "is_next": False,
            "finished": False,
        }
    ],
}

FIXTURES_PAYLOAD = [
    {
        "id": 1,
        "event": 1,
        "kickoff_time": "2025-08-15T19:00:00Z",
        "team_h": 1,
        "team_a": 2,
        "team_h_score": None,
        "team_a_score": None,
        "finished": False,
        "started": False,
    }
]


@pytest.fixture
def mock_table():
    """Patch boto3.resource so the handler writes to a MagicMock instead of DDB."""
    table = MagicMock()
    resource = MagicMock()
    resource.Table.return_value = table
    with patch.object(handler.boto3, "resource", return_value=resource):
        yield table


@pytest.fixture
def s3_bucket():
    """Spin up an in-memory S3 and pre-create the snapshots bucket."""
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=BUCKET_NAME)
        yield client


@pytest.fixture
def no_retry_session(monkeypatch):
    """Strip retries so error tests don't wait on exponential backoff."""
    monkeypatch.setattr(handler, "make_fpl_session", requests.Session)


def _s3_keys(client) -> list[str]:
    resp = client.list_objects_v2(Bucket=BUCKET_NAME)
    return sorted(obj["Key"] for obj in resp.get("Contents", []))


def _s3_body(client, key: str) -> object:
    body = client.get_object(Bucket=BUCKET_NAME, Key=key)["Body"].read()
    return json.loads(body)


@responses.activate
def test_happy_path_writes_to_s3_and_ddb(mock_table, s3_bucket):
    responses.get(BOOTSTRAP_URL, json=BOOTSTRAP_PAYLOAD)
    responses.get(FIXTURES_URL, json=FIXTURES_PAYLOAD)

    result = lambda_handler({}, None)

    assert result["ok"] is True
    assert result["schema_version"] == SCHEMA_VERSION
    assert result["counts"] == {
        "teams": 2,
        "players": 1,
        "gameweeks": 1,
        "fixtures": 1,
    }
    snapshot_id = result["snapshot_id"]
    # ISO-8601 basic-ish: 2026-04-24T12-34-56Z — 20 chars, ends with Z
    assert len(snapshot_id) == 20 and snapshot_id.endswith("Z")

    # S3: exactly two objects at the expected keys with the raw payloads.
    keys = _s3_keys(s3_bucket)
    assert keys == [
        f"fpl/bootstrap-static/{snapshot_id}.json",
        f"fpl/fixtures/{snapshot_id}.json",
    ]
    assert _s3_body(s3_bucket, keys[0]) == BOOTSTRAP_PAYLOAD
    assert _s3_body(s3_bucket, keys[1]) == FIXTURES_PAYLOAD

    # S3 PUT responses set ContentType to application/json.
    head = s3_bucket.head_object(Bucket=BUCKET_NAME, Key=keys[0])
    assert head["ContentType"] == "application/json"

    # DDB: both endpoints cached as 'latest' with the matching fetched_at.
    assert mock_table.put_item.call_count == 2
    items_by_pk = {
        call.kwargs["Item"]["pk"]: call.kwargs["Item"]
        for call in mock_table.put_item.call_args_list
    }
    assert set(items_by_pk) == {"fpl#bootstrap", "fpl#fixtures"}
    for item in items_by_pk.values():
        assert item["sk"] == "latest"
        assert item["schema_version"] == SCHEMA_VERSION
        assert item["fetched_at"] == result["fetched_at"]

    bootstrap_data = items_by_pk["fpl#bootstrap"]["data"]
    assert set(bootstrap_data) == {"teams", "positions", "players", "gameweeks"}
    assert bootstrap_data["players"][0]["web_name"] == "Saka"


@responses.activate
def test_fpl_error_writes_nothing(mock_table, s3_bucket, no_retry_session):
    responses.get(BOOTSTRAP_URL, status=500)

    with pytest.raises(requests.HTTPError):
        lambda_handler({}, None)

    assert _s3_keys(s3_bucket) == []
    mock_table.put_item.assert_not_called()


@responses.activate
def test_partial_fetch_failure_writes_nothing(mock_table, s3_bucket, no_retry_session):
    """Second fetch fails → no S3 object and no DDB item may land."""
    responses.get(BOOTSTRAP_URL, json=BOOTSTRAP_PAYLOAD)
    responses.get(FIXTURES_URL, status=503)

    with pytest.raises(requests.HTTPError):
        lambda_handler({}, None)

    assert _s3_keys(s3_bucket) == []
    mock_table.put_item.assert_not_called()


@responses.activate
def test_s3_failure_blocks_ddb(mock_table, no_retry_session):
    """If S3 archival fails, we must not update the live DDB cache —
    otherwise the invariant 'every DDB write has a matching S3 snapshot'
    breaks. Here we simulate S3 failure by never creating the bucket."""
    responses.get(BOOTSTRAP_URL, json=BOOTSTRAP_PAYLOAD)
    responses.get(FIXTURES_URL, json=FIXTURES_PAYLOAD)

    with mock_aws():
        with pytest.raises(Exception):  # botocore raises ClientError(NoSuchBucket)
            lambda_handler({}, None)

    mock_table.put_item.assert_not_called()
