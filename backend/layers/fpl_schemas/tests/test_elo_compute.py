from __future__ import annotations

import pytest

from elo_compute import DEFAULT_HOME_ADVANTAGE_ELO, expected_score


# ---------------------------------------------------------------------------
# Happy-path math
# ---------------------------------------------------------------------------


def test_evenly_matched_at_home_yields_above_half():
    """Equal raw ELO + home advantage should put the home side above 0.5
    but below 0.6 with the default +65 boost. This is the most common
    PL fixture shape so it's worth pinning."""
    es = expected_score(1800.0, 1800.0, home=True)
    assert 0.5 < es < 0.6


def test_evenly_matched_away_yields_below_half():
    """Mirror image: the away side at equal raw ELO is the slight underdog."""
    es = expected_score(1800.0, 1800.0, home=False)
    assert 0.4 < es < 0.5


def test_strong_home_favourite_close_to_1():
    # Top vs bottom: 200-point ELO gap + home advantage = clear favourite.
    es = expected_score(2000.0, 1600.0, home=True)
    assert es > 0.85


def test_strong_away_underdog_close_to_0():
    # Same matchup viewed from the bottom team's perspective on the road.
    es = expected_score(1600.0, 2000.0, home=False)
    assert es < 0.15


def test_400_point_gap_at_home_matches_classic_elo():
    """Standard ELO theorem: a 400-point gap means the favourite wins
    10/11 of meetings over time. Plus home advantage tightens that
    further. Let the maths drift but pin a reasonable range."""
    es = expected_score(2000.0, 1600.0, home=True)
    # Without home advantage: 0.909. With +65 home bump: a touch higher.
    assert 0.92 < es < 0.94


def test_home_advantage_default_constant():
    """Belt-and-braces: the default constant is the value documented in
    the design (mid-range of the 50-100 used across ELO sources).
    Changes here should be deliberate."""
    assert DEFAULT_HOME_ADVANTAGE_ELO == 65.0


# ---------------------------------------------------------------------------
# None handling
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "label, my, opp",
    [
        ("missing my elo", None, 1800.0),
        ("missing opp elo", 1800.0, None),
        ("both missing", None, None),
    ],
)
def test_returns_none_when_either_elo_missing(label, my, opp):
    """Graceful degradation: caller passes None when ELO data is
    unavailable (mapping miss, fresh deploy, etc.) and gets None back —
    they then write null to storage rather than guessing."""
    assert expected_score(my, opp, home=True) is None, label


# ---------------------------------------------------------------------------
# Home advantage parameter
# ---------------------------------------------------------------------------


def test_explicit_home_advantage_changes_score():
    """Tunable: bumping the advantage to 200 ELO should noticeably
    favour the home side beyond the default."""
    default = expected_score(1800.0, 1800.0, home=True)
    bumped = expected_score(
        1800.0, 1800.0, home=True, home_advantage_elo=200.0,
    )
    assert bumped > default + 0.05


def test_zero_home_advantage_yields_exact_half_at_equal_elo():
    """No home advantage + equal ELOs = pure 50/50. Useful for sanity
    if we ever want to disable the home boost in a special context."""
    es = expected_score(1800.0, 1800.0, home=True, home_advantage_elo=0.0)
    assert es == pytest.approx(0.5)


def test_away_underdog_grows_with_home_advantage():
    """The boost benefits whichever side is at home, not the side whose
    score we're computing. Bumping it should make the away team a
    bigger underdog — bigger boost for the opponent = bigger handicap."""
    no_boost = expected_score(
        1800.0, 1800.0, home=False, home_advantage_elo=0.0,
    )
    big_boost = expected_score(
        1800.0, 1800.0, home=False, home_advantage_elo=200.0,
    )
    assert big_boost < no_boost
    assert no_boost == pytest.approx(0.5)


def test_home_and_away_perspectives_sum_to_one():
    """Symmetry: my home win probability + opponent's away win probability
    for the same fixture must add up to 1. Catches off-by-one and sign
    errors in the home-advantage application."""
    home_score = expected_score(1850.0, 1900.0, home=True)
    away_score = expected_score(1900.0, 1850.0, home=False)
    assert home_score + away_score == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Mathematical sanity
# ---------------------------------------------------------------------------


def test_returned_score_in_unit_interval():
    """For any plausible PL ELO range (1500-2100), result must be a
    valid probability."""
    for me in (1500, 1700, 1900, 2100):
        for opp in (1500, 1700, 1900, 2100):
            for home in (True, False):
                es = expected_score(float(me), float(opp), home=home)
                assert 0 < es < 1
