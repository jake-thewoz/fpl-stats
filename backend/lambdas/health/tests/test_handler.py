from datetime import datetime

from handler import lambda_handler


def test_returns_ok_with_iso_timestamp():
    response = lambda_handler({}, None)

    assert response["ok"] is True
    parsed = datetime.fromisoformat(response["time"])
    assert parsed.tzinfo is not None, "timestamp must be timezone-aware"
