from __future__ import annotations

from urllib3.util.retry import Retry

from fpl_session import DEFAULT_USER_AGENT, make_fpl_session


def test_session_sets_default_user_agent():
    session = make_fpl_session()
    assert session.headers.get("User-Agent") == DEFAULT_USER_AGENT


def test_session_default_ua_is_browser_like():
    """Sanity check on the default. If someone changes this to
    'python-requests/X.Y.Z' or empties it, FPL's filter starts 403'ing.
    The 'Mozilla/' prefix is the most reliable browser-UA marker."""
    assert DEFAULT_USER_AGENT.startswith("Mozilla/")


def test_session_honors_custom_user_agent():
    custom = "MyApp/1.0 (https://example.com)"
    session = make_fpl_session(user_agent=custom)
    assert session.headers.get("User-Agent") == custom


def test_session_mounts_retry_adapter_on_https():
    session = make_fpl_session()
    adapter = session.get_adapter("https://fantasy.premierleague.com/")
    retry = adapter.max_retries
    assert isinstance(retry, Retry)
    assert retry.total == 3
    # 429 (FPL rate-limit) must be in the retry list — the whole point of
    # this helper is to avoid surfacing transient FPL noise to clients.
    assert 429 in retry.status_forcelist
    # Plus the standard 5xx family.
    for status in (500, 502, 503, 504):
        assert status in retry.status_forcelist


def test_session_only_retries_get():
    """We never POST/PUT to FPL — but if a future handler does, it should
    not silently retry mutations. Lock the policy to GET so an
    accidental write doesn't get retried twice."""
    session = make_fpl_session()
    adapter = session.get_adapter("https://fantasy.premierleague.com/")
    assert adapter.max_retries.allowed_methods == frozenset({"GET"})
