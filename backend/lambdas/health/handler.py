"""Health-check Lambda — returns a fixed ok payload plus the current UTC time."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    return {
        "ok": True,
        "time": datetime.now(timezone.utc).isoformat(),
    }
