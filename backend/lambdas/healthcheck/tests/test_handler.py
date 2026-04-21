import json

from handler import lambda_handler


def test_returns_ok():
    response = lambda_handler({}, None)
    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {"status": "ok"}
