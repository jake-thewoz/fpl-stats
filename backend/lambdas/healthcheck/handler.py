"""Minimal Lambda used to validate the Python build pattern end-to-end."""
from __future__ import annotations

import json
from typing import Any


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    return {
        "statusCode": 200,
        "body": json.dumps({"status": "ok"}),
    }
