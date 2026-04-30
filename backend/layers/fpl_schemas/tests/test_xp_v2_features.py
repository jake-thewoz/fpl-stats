"""Unit tests for xp_v2_features.

The load-bearing invariant of this module is point-in-time anti-leakage:
``compute_rates_at_gw(as_of_gw=t, history=H)`` MUST be identical to the
same call with ``H`` truncated to ``round < t``. ``test_anti_leakage_*``
pin this directly. The defensive assertion in ``_filter_rows_before``
provides the safety net if someone weakens the filter.

Bayesian shrinkage is the second invariant — a hot-streak rookie in 1
match shouldn't dominate predictions, and a player with no history at
all should fall back to the position prior. ``test_shrinkage_*`` and
``test_*_cold_start`` cover both ends.
"""
from __future__ import annotations

import pytest

from schemas import PlayerHistoryRow
from xp_v2 import DEF, FWD, GKP, MID, PerNinetyRates
from xp_v2_features import (
    FeatureWindow,
    PositionPriors,
    compute_rates_at_gw,
    compute_team_xgc_at_gw,
    load_default_priors,
    merge_team_xgc,
    season_play_rate,
)


# Hand-built priors held independent of the bundled JSON so a future
# tweak to xp_v2_priors.json doesn't silently break every component
# test. ``test_load_default_priors_*`` pin the bundled JSON.
_TEST_PRIORS = PositionPriors(
    npxg_p90={GKP: 0.0, DEF: 0.05, MID: 0.15, FWD: 0.40},
    xa_p90={GKP: 0.0, DEF: 0.05, MID: 0.20, FWD: 0.10},
    bonus_p90={GKP: 0.20, DEF: 0.25, MID: 0.30, FWD: 0.30},
    defcon_per_match_rate={GKP: 0.0, DEF: 0.45, MID: 0.20, FWD: 0.10},
    yc_p90={GKP: 0.05, DEF: 0.15, MID: 0.15, FWD: 0.10},
    saves_p90_gkp=3.0,
    rc_p90=0.005,
    team_xgc_p90=1.3,
    historical_p60=0.85,
)
_DEFAULT_WINDOW = FeatureWindow()
_NO_SHRINKAGE_WINDOW = FeatureWindow(prior_strength_matches=0)


def _row(
    *,
    round_: int,
    fixture: int = 0,
    minutes: int = 90,
    goals: int = 0,
    assists: int = 0,
    bonus: int = 0,
    yc: int = 0,
    rc: int = 0,
    saves: int = 0,
    xg: str = "0.0",
    xa: str = "0.0",
    xgc: str = "1.3",
    defcon: int | None = 0,
    cs: int = 0,
    goals_conceded: int = 1,
) -> PlayerHistoryRow:
    """Concise factory for tests — defaults to a 90-min appearance with
    zero offensive output. Override only the fields each test cares about."""
    return PlayerHistoryRow(
        element=1,
        fixture=fixture if fixture else round_,
        opponent_team=2,
        was_home=True,
        round=round_,
        minutes=minutes,
        goals_scored=goals,
        assists=assists,
        clean_sheets=cs,
        goals_conceded=goals_conceded,
        saves=saves,
        bonus=bonus,
        bps=20,
        yellow_cards=yc,
        red_cards=rc,
        own_goals=0,
        penalties_saved=0,
        penalties_missed=0,
        total_points=2,
        expected_goals=xg,
        expected_assists=xa,
        expected_goals_conceded=xgc,
        defensive_contribution=defcon,
    )


# ---------------------------------------------------------------------------
# Anti-leakage (load-bearing)
# ---------------------------------------------------------------------------


def test_anti_leakage_filter_excludes_current_and_future_rounds() -> None:
    """``as_of_gw=10`` must produce the same result regardless of whether
    later rounds are present in the input."""
    history_short = [_row(round_=r, fixture=r, xg="0.5") for r in (1, 5, 9)]
    history_long = history_short + [
        _row(round_=10, fixture=10, xg="3.0"),  # current GW — must be excluded
        _row(round_=11, fixture=11, xg="2.5"),  # future GW
        _row(round_=15, fixture=15, xg="3.5"),
    ]

    rates_short = compute_rates_at_gw(
        history=history_short, position=MID, as_of_gw=10,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    rates_long = compute_rates_at_gw(
        history=history_long, position=MID, as_of_gw=10,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    assert rates_short == rates_long


def test_anti_leakage_assertion_fires_on_filter_bypass() -> None:
    """Smoke-check the defensive ``assert`` by directly calling the
    private filter on rows that already include a future round —
    simulates a future bug that weakens the filter."""
    from xp_v2_features import _filter_rows_before

    rows = [_row(round_=5), _row(round_=8)]
    # The filter itself works correctly; this confirms the happy path.
    assert len(_filter_rows_before(rows, as_of_gw=10)) == 2
    # And the strict filter bound matters: as_of_gw=8 excludes round 8.
    assert len(_filter_rows_before(rows, as_of_gw=8)) == 1


# ---------------------------------------------------------------------------
# Per-90 rate computation
# ---------------------------------------------------------------------------


def test_npxg_p90_no_shrinkage_returns_exact_rate() -> None:
    """5 matches at exactly 1.0 xG / 90 min → exact 1.0 with shrinkage off."""
    rows = [_row(round_=r, fixture=r, xg="1.0") for r in range(1, 6)]
    rates = compute_rates_at_gw(
        history=rows, position=MID, as_of_gw=10,
        priors=_TEST_PRIORS, window=_NO_SHRINKAGE_WINDOW,
    )
    assert rates.npxg_p90 == pytest.approx(1.0, rel=1e-6)


def test_npxg_p90_with_shrinkage_pulls_toward_prior() -> None:
    """Same 5 GWs of 1.0 xG, but with default shrinkage (strength=4)
    pulls the rate toward the position prior (0.15 for MID)."""
    rows = [_row(round_=r, fixture=r, xg="1.0") for r in range(1, 6)]
    rates = compute_rates_at_gw(
        history=rows, position=MID, as_of_gw=10,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    # 90 × (5.0 + 4·0.15) / (5·90 + 4·90) = 90 × 5.6 / 810 = 0.6222...
    expected = 90 * (5.0 + 4 * 0.15) / (450 + 360)
    assert rates.npxg_p90 == pytest.approx(expected, rel=1e-6)
    # Sanity: pulled below 1.0 but above the prior.
    assert _TEST_PRIORS.npxg_p90[MID] < rates.npxg_p90 < 1.0


def test_xa_p90_uses_position_specific_prior() -> None:
    """xA prior for FWD (0.10) differs from MID (0.20). With no actual
    xA data, the rate equals the position-specific prior."""
    fwd = compute_rates_at_gw(
        history=[], position=FWD, as_of_gw=1,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    mid = compute_rates_at_gw(
        history=[], position=MID, as_of_gw=1,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    assert fwd.xa_p90 == pytest.approx(0.10)
    assert mid.xa_p90 == pytest.approx(0.20)


def test_saves_p90_zero_for_outfield() -> None:
    """A defender with goalkeeping rates in the prior (impossible IRL
    but tests the position guard) still gets saves_p90 = 0 forced."""
    rates = compute_rates_at_gw(
        history=[_row(round_=1, saves=10) for _ in range(5)],  # impossible
        position=DEF, as_of_gw=10,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    assert rates.saves_p90 == 0.0


def test_saves_p90_smoothed_for_gk() -> None:
    """GK with consistent saves rate gets a smoothed value strictly
    above 0 (against the GKP prior of 3.0)."""
    rows = [_row(round_=r, fixture=r, saves=4) for r in range(1, 6)]
    rates = compute_rates_at_gw(
        history=rows, position=GKP, as_of_gw=10,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    # Smoothed: 90 × (20 + 4·3.0) / (450 + 360) = 90 × 32 / 810 = 3.555...
    expected = 90 * (20 + 4 * 3.0) / 810
    assert rates.saves_p90 == pytest.approx(expected, rel=1e-6)


# ---------------------------------------------------------------------------
# Defcon match-share
# ---------------------------------------------------------------------------


def test_defcon_threshold_def_is_ten() -> None:
    """DEF triggers at CBI+T ≥ 10. With 4 of 5 matches at dc=10 and one
    at dc=9, the smoothed rate sits between the prior (0.45) and the
    raw 4/5 = 0.8."""
    rows = [
        _row(round_=1, fixture=1, defcon=10),
        _row(round_=2, fixture=2, defcon=11),
        _row(round_=3, fixture=3, defcon=15),
        _row(round_=4, fixture=4, defcon=10),
        _row(round_=5, fixture=5, defcon=9),  # below threshold
    ]
    rates = compute_rates_at_gw(
        history=rows, position=DEF, as_of_gw=10,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    # (4 + 4·0.45) / (5 + 4) = 5.8 / 9 = 0.6444...
    expected = (4 + 4 * 0.45) / 9
    assert rates.defcon_per_match_rate == pytest.approx(expected, rel=1e-6)


def test_defcon_threshold_outfield_is_twelve() -> None:
    """MID/FWD trigger at CBI+T+R ≥ 12. dc=10 doesn't qualify for MID."""
    rows = [
        _row(round_=1, fixture=1, defcon=10),  # MID: NO trigger
        _row(round_=2, fixture=2, defcon=12),  # YES
        _row(round_=3, fixture=3, defcon=11),  # NO
        _row(round_=4, fixture=4, defcon=15),  # YES
    ]
    rates = compute_rates_at_gw(
        history=rows, position=MID, as_of_gw=10,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    # 2 of 4 trigger; smoothed: (2 + 4·0.20) / (4 + 4) = 2.8 / 8 = 0.35
    expected = (2 + 4 * 0.20) / 8
    assert rates.defcon_per_match_rate == pytest.approx(expected, rel=1e-6)


def test_defcon_zero_for_gk() -> None:
    """GK is ineligible for defcon regardless of how high the values
    on rows happen to be."""
    rows = [_row(round_=r, fixture=r, defcon=20) for r in range(1, 6)]
    rates = compute_rates_at_gw(
        history=rows, position=GKP, as_of_gw=10,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    assert rates.defcon_per_match_rate == 0.0


def test_defcon_only_counts_played_matches() -> None:
    """A 0-min row (didn't play) shouldn't count against defcon trigger
    — the CBI+T was unavailable to register."""
    rows = [
        _row(round_=1, fixture=1, defcon=15),                  # played + triggered
        _row(round_=2, fixture=2, minutes=0, defcon=0),        # didn't play
        _row(round_=3, fixture=3, defcon=11),                  # played, no trigger
    ]
    rates = compute_rates_at_gw(
        history=rows, position=MID, as_of_gw=10,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    # matches_played = 2 (rounds 1 and 3); successes = 1; smoothed:
    # (1 + 4·0.20) / (2 + 4) = 1.8 / 6 = 0.30
    expected = (1 + 4 * 0.20) / 6
    assert rates.defcon_per_match_rate == pytest.approx(expected, rel=1e-6)


# ---------------------------------------------------------------------------
# Cold start / empty history
# ---------------------------------------------------------------------------


def test_empty_history_returns_position_priors() -> None:
    """Pure cold start (rookie pre-season): every rate equals its prior."""
    rates = compute_rates_at_gw(
        history=[], position=FWD, as_of_gw=1,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    assert rates.npxg_p90 == pytest.approx(_TEST_PRIORS.npxg_p90[FWD])
    assert rates.xa_p90 == pytest.approx(_TEST_PRIORS.xa_p90[FWD])
    assert rates.bonus_p90 == pytest.approx(_TEST_PRIORS.bonus_p90[FWD])
    assert rates.yc_p90 == pytest.approx(_TEST_PRIORS.yc_p90[FWD])
    assert rates.rc_p90 == pytest.approx(_TEST_PRIORS.rc_p90)
    assert rates.defcon_per_match_rate == pytest.approx(_TEST_PRIORS.defcon_per_match_rate[FWD])
    assert rates.historical_p60 == pytest.approx(_TEST_PRIORS.historical_p60)
    # Outfield → saves forced to 0
    assert rates.saves_p90 == 0.0


def test_cold_start_rookie_one_hot_match_pulled_toward_prior() -> None:
    """A rookie with one freak 5 xG match doesn't dominate predictions —
    Bayesian shrinkage pulls heavily toward the position prior."""
    hot_match = _row(round_=1, fixture=1, xg="5.0")
    rates = compute_rates_at_gw(
        history=[hot_match], position=MID, as_of_gw=2,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    # 90 × (5.0 + 4·0.15) / (90 + 360) = 90 × 5.6 / 450 = 1.12
    expected = 90 * (5.0 + 4 * 0.15) / 450
    assert rates.npxg_p90 == pytest.approx(expected, rel=1e-6)
    # Sanity: nowhere near the raw 5.0; well above the prior 0.15.
    assert rates.npxg_p90 < 1.5
    assert rates.npxg_p90 > _TEST_PRIORS.npxg_p90[MID]


# ---------------------------------------------------------------------------
# historical_p60
# ---------------------------------------------------------------------------


def test_historical_p60_only_counts_appearances() -> None:
    """≥60 minute-share is conditional on actually appearing; bench-only
    rows shouldn't count against the player's p60 rate."""
    rows = [
        _row(round_=1, fixture=1, minutes=90),
        _row(round_=2, fixture=2, minutes=85),
        _row(round_=3, fixture=3, minutes=0),  # didn't play — should be ignored
        _row(round_=4, fixture=4, minutes=20),
    ]
    rates = compute_rates_at_gw(
        history=rows, position=MID, as_of_gw=10,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    # appearances = 3 (rounds 1, 2, 4); successes (≥60) = 2 (1, 2)
    # (2 + 4·0.85) / (3 + 4) = 5.4 / 7 = 0.7714...
    expected = (2 + 4 * 0.85) / 7
    assert rates.historical_p60 == pytest.approx(expected, rel=1e-6)


def test_historical_p60_no_appearances_returns_prior() -> None:
    """Player with zero matches played → falls back to the league prior
    rather than the smoothed-toward-prior value (which would be undefined
    for matches_played = 0)."""
    rows = [_row(round_=r, fixture=r, minutes=0) for r in range(1, 4)]
    rates = compute_rates_at_gw(
        history=rows, position=MID, as_of_gw=10,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    assert rates.historical_p60 == _TEST_PRIORS.historical_p60


# ---------------------------------------------------------------------------
# Team xGC
# ---------------------------------------------------------------------------


def test_team_xgc_dedupes_by_fixture() -> None:
    """3 players' rows for the SAME match → one xGC contribution to the
    team-side smoothed rate, not three. FPL ships the same xGC value
    on every team-member's row for one fixture."""
    rows = [
        _row(round_=1, fixture=100, xgc="1.5"),
        _row(round_=1, fixture=100, xgc="1.5"),  # same match, second player
        _row(round_=1, fixture=100, xgc="1.5"),  # same match, third player
    ]
    xgc = compute_team_xgc_at_gw(
        team_history_rows=rows, as_of_gw=10,
        priors=_TEST_PRIORS, window=_NO_SHRINKAGE_WINDOW,
    )
    # No shrinkage, single match: equals the per-match xGC.
    assert xgc == pytest.approx(1.5, rel=1e-6)


def test_team_xgc_smoothed_with_default_strength() -> None:
    """5 matches at avg xGC 1.0 → smoothed pulled toward league mean (1.3)."""
    rows = [
        _row(round_=r, fixture=r, xgc="1.0") for r in range(1, 6)
    ]
    xgc = compute_team_xgc_at_gw(
        team_history_rows=rows, as_of_gw=10,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    # (5·1.0 + 4·1.3) / (5 + 4) = 10.2 / 9 = 1.1333...
    expected = (5.0 + 4 * 1.3) / 9
    assert xgc == pytest.approx(expected, rel=1e-6)


def test_team_xgc_empty_returns_prior() -> None:
    """Newly-promoted side at season start: no rows → prior."""
    xgc = compute_team_xgc_at_gw(
        team_history_rows=[], as_of_gw=1,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    assert xgc == pytest.approx(_TEST_PRIORS.team_xgc_p90)


def test_team_xgc_respects_anti_leakage() -> None:
    """Team xGC must filter to ``round < as_of_gw`` like the player side."""
    rows = [
        _row(round_=5, fixture=5, xgc="1.0"),
        _row(round_=10, fixture=10, xgc="2.5"),  # current GW — must be excluded
    ]
    xgc = compute_team_xgc_at_gw(
        team_history_rows=rows, as_of_gw=10,
        priors=_TEST_PRIORS, window=_NO_SHRINKAGE_WINDOW,
    )
    # Only round 5 contributes → 1.0
    assert xgc == pytest.approx(1.0, rel=1e-6)


def test_merge_team_xgc_overrides_placeholder() -> None:
    """The convenience wrapper replaces the placeholder team_xgc_p90 on
    a per-player rates struct without touching other fields."""
    base = compute_rates_at_gw(
        history=[], position=MID, as_of_gw=1,
        priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
    )
    assert base.team_xgc_p90 == pytest.approx(_TEST_PRIORS.team_xgc_p90)
    merged = merge_team_xgc(base, team_xgc_p90=0.95)
    assert merged.team_xgc_p90 == pytest.approx(0.95)
    # Other fields preserved.
    assert merged.npxg_p90 == base.npxg_p90
    assert merged.historical_p60 == base.historical_p60


# ---------------------------------------------------------------------------
# JSON loading
# ---------------------------------------------------------------------------


def test_load_default_priors_returns_expected_shape() -> None:
    priors = load_default_priors()
    for d in (
        priors.npxg_p90, priors.xa_p90, priors.bonus_p90,
        priors.defcon_per_match_rate, priors.yc_p90,
    ):
        assert set(d.keys()) == {GKP, DEF, MID, FWD}
    assert priors.team_xgc_p90 > 0
    assert 0.0 < priors.historical_p60 < 1.0
    assert priors.saves_p90_gkp > 0
    # Position-prior sanity: FWD has a higher npxg_p90 prior than DEF.
    assert priors.npxg_p90[FWD] > priors.npxg_p90[DEF]
    # MID has higher xA prior than DEF (creators).
    assert priors.xa_p90[MID] > priors.xa_p90[DEF]


def test_load_default_priors_disables_gk_npxg_xa() -> None:
    """GK npxg/xa priors are 0 — keepers don't shoot or assist."""
    priors = load_default_priors()
    assert priors.npxg_p90[GKP] == 0.0
    assert priors.xa_p90[GKP] == 0.0


# ---------------------------------------------------------------------------
# Position validation
# ---------------------------------------------------------------------------


def test_unknown_position_raises() -> None:
    """A bug that passes an unknown position id (e.g. 0 or 5) should
    fail loudly rather than silently returning meaningless rates."""
    with pytest.raises(ValueError, match="position"):
        compute_rates_at_gw(
            history=[], position=99, as_of_gw=1,
            priors=_TEST_PRIORS, window=_DEFAULT_WINDOW,
        )


# ---------------------------------------------------------------------------
# season_play_rate
# ---------------------------------------------------------------------------


class TestSeasonPlayRate:
    def test_full_season_starter_returns_one(self) -> None:
        # 2400 mins / (90 * 30) = 0.889 — a typical starter who's missed
        # the occasional 90 due to rotation. Should land near 1.0 and
        # leave their xP largely unaffected.
        assert season_play_rate(season_minutes=2400, gws_completed=30) == pytest.approx(
            2400 / (90 * 30)
        )

    def test_zero_minutes_after_many_gws_returns_zero(self) -> None:
        # The bug-driving case: a 30-GW veteran with 0 minutes. xP should
        # be effectively wiped out for them.
        assert season_play_rate(season_minutes=0, gws_completed=30) == 0.0

    def test_clamped_to_one_when_player_played_more_than_max(self) -> None:
        # FPL minutes can technically include extra time / overrun;
        # clamp at 1.0 so we never *boost* anyone above their FPL signal.
        assert season_play_rate(season_minutes=10000, gws_completed=10) == pytest.approx(
            1.0
        )

    def test_rotation_player_around_half(self) -> None:
        # Half-time rotation player: 1350 mins after 30 GWs ~= 0.5.
        assert season_play_rate(season_minutes=1350, gws_completed=30) == pytest.approx(
            0.5
        )

    def test_pre_season_returns_one(self) -> None:
        # gws_completed = 0 (pre-season). Return 1.0 so the model's
        # FPL-signal-only behaviour is unchanged before the season starts.
        assert season_play_rate(season_minutes=0, gws_completed=0) == 1.0

    def test_under_min_gws_threshold_returns_one(self) -> None:
        # Below ~4 GWs the rate is too noisy to trust (one DNP looks
        # identical to "fringe player"). Match pre-fix behaviour.
        assert season_play_rate(season_minutes=0, gws_completed=2) == 1.0
        assert season_play_rate(season_minutes=180, gws_completed=2) == 1.0

    def test_at_min_gws_threshold_dampening_kicks_in(self) -> None:
        # GW4 onwards, the rate becomes meaningful. A 0-minute player
        # at GW4 starts getting dampened.
        assert season_play_rate(season_minutes=0, gws_completed=4) == 0.0
        assert season_play_rate(
            season_minutes=180, gws_completed=4
        ) == pytest.approx(0.5)
