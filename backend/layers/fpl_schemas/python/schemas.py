"""Typed, versioned schema for cached FPL entities.

These pydantic models are the contract between the ingestion Lambda (which
parses the raw FPL API responses) and every reader of the DynamoDB cache.
FPL's unofficial API can change shape mid-season — parsing through these
models means a schema drift surfaces as a validation error in ingestion
logs rather than silently corrupting the cache.

Bumping the schema
------------------
Bump ``SCHEMA_VERSION`` whenever the stored shape changes in a way that
existing readers can't handle. The ``schema_version`` field is written on
every cached item; readers should compare against the version they were
built for and either degrade gracefully or fail loudly.

Guidance:

- **Additive changes** (new optional field on an existing model): no bump
  needed — readers pinned to the old version ignore new fields.
- **Breaking changes** (renaming, removing, or narrowing a field):
  increment ``SCHEMA_VERSION`` and update every reader. Because ingestion
  overwrites the cache every 30 minutes, there's no back-compat window to
  worry about — just ship reader and writer together.
- **FPL-side drift** (FPL adds/renames a field we care about): update the
  relevant model, bump if it's breaking, and re-deploy.

Location note
-------------
This module currently lives inside ``ingest_fpl`` because it's the only
consumer. The first time a read-path Lambda (e.g. GET /players,
GET /gameweek/current) needs to import these models, promote the module
to a Lambda layer or shared-bundling setup.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = 1


class Team(BaseModel):
    id: int
    name: str
    short_name: str
    code: int


class Position(BaseModel):
    """One of the four FPL positions — goalkeeper/defender/midfielder/forward."""

    id: int
    singular_name: str
    singular_name_short: str


class Player(BaseModel):
    id: int
    first_name: str
    second_name: str
    web_name: str
    team: int
    element_type: int
    total_points: int
    form: str
    now_cost: int


class Gameweek(BaseModel):
    id: int
    name: str
    deadline_time: str
    is_current: bool
    is_next: bool
    finished: bool


class Bootstrap(BaseModel):
    """Subset of FPL ``/bootstrap-static/`` we cache.

    Input aliases keep us compatible with FPL's legacy field names
    (``events``, ``elements``, ``element_types``) while our stored shape
    uses domain names (``gameweeks``, ``players``, ``positions``).
    """

    model_config = ConfigDict(populate_by_name=True)

    teams: list[Team]
    positions: list[Position] = Field(alias="element_types")
    players: list[Player] = Field(alias="elements")
    gameweeks: list[Gameweek] = Field(alias="events")


class Fixture(BaseModel):
    id: int
    event: int | None = None
    kickoff_time: str | None = None
    team_h: int
    team_a: int
    team_h_score: int | None = None
    team_a_score: int | None = None
    finished: bool
    started: bool | None = None


class Entry(BaseModel):
    """Subset of FPL ``/entry/{id}/`` we cache per-team."""

    id: int
    name: str
    player_first_name: str
    player_last_name: str
    started_event: int
    favourite_team: int | None = None
    summary_overall_points: int | None = None
    summary_overall_rank: int | None = None
    summary_event_points: int | None = None
    summary_event_rank: int | None = None
    current_event: int | None = None
    last_deadline_value: int | None = None
    last_deadline_bank: int | None = None
    last_deadline_total_transfers: int | None = None


class EntryPick(BaseModel):
    """One of the 15 squad slots for a given gameweek."""

    element: int
    position: int
    multiplier: int
    is_captain: bool
    is_vice_captain: bool


class EntryHistory(BaseModel):
    """Per-gameweek score + bank/value snapshot for an entry."""

    event: int
    points: int
    total_points: int
    rank: int | None = None
    overall_rank: int | None = None
    bank: int | None = None
    value: int | None = None
    event_transfers: int | None = None
    event_transfers_cost: int | None = None
    points_on_bench: int | None = None


class EntryPicks(BaseModel):
    """Subset of FPL ``/entry/{id}/event/{gw}/picks/`` we cache per (team, gw)."""

    active_chip: str | None = None
    picks: list[EntryPick]
    entry_history: EntryHistory


class GameweekLiveElement(BaseModel):
    """Per-player live stats for a gameweek — what we keep is tight on
    purpose: id, points, minutes. Any future needs (bonus, goals, xG join
    targets) can be added as optional fields without a schema bump."""

    id: int
    total_points: int
    minutes: int


class GameweekLive(BaseModel):
    """Subset of FPL ``/event/{gw}/live/`` we cache per gameweek."""

    elements: list[GameweekLiveElement]


class LeagueInfo(BaseModel):
    """Minimal classic-league metadata we surface to clients."""

    id: int
    name: str


class LeagueMember(BaseModel):
    """One entry in a classic league's standings. ``entry`` is the FPL
    team ID used everywhere else; ``entry_name`` is that team's name;
    ``player_name`` is the manager."""

    entry: int
    entry_name: str
    player_name: str
    rank: int
    total: int


class LeagueStandings(BaseModel):
    """Subset of FPL ``/leagues-classic/{id}/standings/`` we cache per league.
    MVP keeps only page 1 (FPL paginates 50-per-page); ``has_more`` flags
    when the upstream had additional pages we didn't fetch."""

    league: LeagueInfo
    members: list[LeagueMember]
    has_more: bool = False
