"""Shared HTTP session factory for FPL outbound calls.

Single source of truth for the User-Agent header and retry config used
when any of our Lambdas hit the public FPL API.

Why this exists
---------------
FPL's API fingerprints inbound requests and returns 403 to anything that
looks too obviously scripted — most notably the default
``python-requests/X.Y.Z`` User-Agent. Setting a browser-like UA reliably
gets past the filter; without it any of our FPL-fetching Lambdas can
flake or hard-fail at any time. Centralising the session factory means a
future UA rotation (or a more aggressive retry policy) is one edit, not
seven.
"""
from __future__ import annotations

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Recent Chrome-on-macOS UA. Browser-like is what works reliably against
# FPL's filter; we revisit if FPL tightens further. The community FPL
# Python clients use similar strings.
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36"
)

# Retry on transient upstream errors. 429 included — FPL occasionally
# rate-limits; better to wait and retry than 502 our own client. Total=3
# with backoff_factor=1 gives roughly 0s/2s/4s between attempts.
_RETRY_TOTAL = 3
_RETRY_BACKOFF = 1
_RETRY_STATUSES = (429, 500, 502, 503, 504)


def make_fpl_session(user_agent: str = DEFAULT_USER_AGENT) -> requests.Session:
    """Build a ``requests.Session`` configured for outbound FPL calls.

    Sets the User-Agent header at session level so it applies to every
    request (including retries — the adapter's retry path goes back
    through the session, which keeps the headers attached).
    """
    session = requests.Session()
    session.headers.update({"User-Agent": user_agent})
    retry = Retry(
        total=_RETRY_TOTAL,
        backoff_factor=_RETRY_BACKOFF,
        status_forcelist=list(_RETRY_STATUSES),
        allowed_methods=frozenset({"GET"}),
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session
