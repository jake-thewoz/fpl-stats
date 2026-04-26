"""Pure ELO computation helpers, shared across analyzers.

Used by the form analyzer to compute ``elo_expected_score`` per upcoming
fixture, alongside FPL's own difficulty rating. Side-effect-free so it's
unit-testable in isolation.
"""
from __future__ import annotations

from typing import Optional

# Mid-range home-field advantage in ELO points. ClubELO uses ~87 internally
# for predictions but doesn't include it in published per-team ratings —
# we apply it on our side. Tunable via ``HOME_ADVANTAGE_ELO`` env var on
# any caller; pass through ``home_advantage_elo`` to override per-call.
DEFAULT_HOME_ADVANTAGE_ELO = 65.0


def expected_score(
    my_elo: Optional[float],
    opp_elo: Optional[float],
    *,
    home: bool,
    home_advantage_elo: float = DEFAULT_HOME_ADVANTAGE_ELO,
) -> Optional[float]:
    """Standard ELO win-probability formula. Returns ``None`` if either
    ELO is missing so the caller can leave the corresponding stored
    field null rather than guessing.

    Home advantage is added to the home side's effective rating before
    the comparison, matching how match-prediction services typically
    apply it. The 400-point divisor is ELO's standard scaling constant
    (a 400-point gap means the favourite wins ~10x out of every 11
    matches in the long run).
    """
    if my_elo is None or opp_elo is None:
        return None
    # The home boost benefits whichever side is playing at home — when
    # computing the away side's score, the *opponent* (who is at home)
    # gets the boost, which makes the away side the underdog. Forgetting
    # this gives 0.5 for any equal-ELO matchup, which silently masks
    # ELO's value as a signal.
    if home:
        my_effective = my_elo + home_advantage_elo
        opp_effective = opp_elo
    else:
        my_effective = my_elo
        opp_effective = opp_elo + home_advantage_elo
    return 1.0 / (1.0 + 10 ** ((opp_effective - my_effective) / 400))
