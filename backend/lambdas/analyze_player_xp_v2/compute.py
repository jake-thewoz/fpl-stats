"""Pure helpers for the analyze_player_xp_v2 Lambda.

Kept side-effect-free so the handler's orchestration can be tested
against synthetic data without hitting DDB.

Why these helpers live here instead of in the layer
---------------------------------------------------
``opp_strength_from_difficulty`` and ``build_fixture_context`` are
specific to the v2 *inference* path: they translate FPL's per-fixture
difficulty rating into the continuous ``opponent_strength`` signal
that ``xp_v2.xp_for_fixture`` consumes. The offline fit (Phase 3)
doesn't use this mapping — it pins ``opp_strength = 0.5`` on every
training pair, since per-row history doesn't carry difficulty.

So they live in this Lambda rather than the shared layer to keep the
boundary clean: the layer is the math + features, this Lambda is the
production wiring.
"""
from __future__ import annotations

from typing import Optional

from schemas import Fixture
from xp_v2 import FixtureContext


def opp_strength_from_difficulty(difficulty: Optional[int]) -> float:
    """Map FPL's 1-5 fixture difficulty to ``opponent_strength`` ∈ [0, 1].

    ``opponent_strength`` is centered at 0.5 (mid-tier opponent) in
    xp_v2's fixture-factor math. We map:

      1 (easiest)  → 0.0 (very weak opponent)
      3 (mid-tier) → 0.5 (neutral, fixture factor unchanged)
      5 (toughest) → 1.0 (very strong opponent)

    None → 0.5 (neutral fallback) so a missing difficulty doesn't
    silently rank a player up or down — same conservative choice
    that ``xp_compute.fixture_easiness`` makes for v1.

    Note: FPL's per-side difficulty already factors in home advantage
    (a home fixture against the same opponent is rated easier than
    away). xp_v2 also applies its own ``home_advantage`` coefficient,
    so there's a small double-count here. Acceptable for v2.0; Phase 7
    can replace with a cleaner signal (e.g. ClubELO win-prob with
    home advantage stripped).
    """
    if difficulty is None:
        return 0.5
    return (difficulty - 1) / 4.0


def player_difficulty(fixture: Fixture, team_id: int) -> Optional[int]:
    """FPL's 1-5 difficulty rating for ``team_id`` in this fixture, or
    None if the fixture predates difficulty fields being stored or
    ``team_id`` isn't actually playing this match (defensive)."""
    if fixture.team_h == team_id:
        return fixture.team_h_difficulty
    if fixture.team_a == team_id:
        return fixture.team_a_difficulty
    return None


def build_fixture_context(fixture: Fixture, team_id: int) -> FixtureContext:
    """Build the v2 FixtureContext for ``team_id`` playing this fixture."""
    home = fixture.team_h == team_id
    difficulty = player_difficulty(fixture, team_id)
    return FixtureContext(
        home=home,
        opponent_strength=opp_strength_from_difficulty(difficulty),
        fpl_difficulty=difficulty,
    )


def opponent_team_id(fixture: Fixture, team_id: int) -> int:
    """Return the *other* team's id from this fixture, for ``team_id``'s
    perspective. Used to surface an explainability field on the stored
    row so consumers can show 'next opponent'."""
    return fixture.team_a if fixture.team_h == team_id else fixture.team_h
