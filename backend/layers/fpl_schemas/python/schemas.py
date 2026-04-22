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
