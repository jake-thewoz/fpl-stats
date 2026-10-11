/**
 * The next few gameweeks of fixtures per club, joined onto player rows
 * by club short name. Feeds the fixture strip column on Players and My
 * Team, and maps an FPL entry's `favourite_team` id to a club.
 */
import type { ClubFixture, FixturesUpcomingResponse } from '../api/fixturesUpcoming';

/** One slot per upcoming gameweek: empty for a blank, two for a double. */
export type GameweekFixtures = readonly ClubFixture[];

export type UpcomingFixtures = {
  gameweeks: readonly number[];
  byClub: ReadonlyMap<string, readonly GameweekFixtures[]>;
  clubShortNameById: ReadonlyMap<number, string>;
};

/** Hardest rating on FPL's scale. A blank gameweek scores no points, so
 *  it counts as the hardest possible fixture when averaging a run. */
export const HARDEST_DIFFICULTY = 5;

export function indexUpcomingFixtures(
  response: FixturesUpcomingResponse,
): UpcomingFixtures {
  return {
    gameweeks: response.gameweeks,
    byClub: new Map(response.teams.map((team) => [team.short_name, team.fixtures])),
    clubShortNameById: new Map(response.teams.map((team) => [team.id, team.short_name])),
  };
}

/** Mean difficulty of a club's run, null with no gameweeks to rate.
 *  Unrated fixtures are skipped; a blank gameweek counts as the hardest. */
export function averageDifficulty(run: readonly GameweekFixtures[]): number | null {
  const ratings: number[] = [];
  for (const gameweek of run) {
    if (gameweek.length === 0) {
      ratings.push(HARDEST_DIFFICULTY);
      continue;
    }
    for (const fixture of gameweek) {
      if (fixture.difficulty != null) ratings.push(fixture.difficulty);
    }
  }
  if (ratings.length === 0) return null;
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
}

/** The fixture fields of a `JoinedPlayer` for a player at `club`. Null
 *  while fixtures are loading or when the club isn't in the response. */
export function playerFixtureFields(
  upcoming: UpcomingFixtures | undefined,
  club: string,
): { fixtures: readonly GameweekFixtures[] | null; fixture_difficulty: number | null } {
  const run = upcoming?.byClub.get(club);
  if (run == null) return { fixtures: null, fixture_difficulty: null };
  return { fixtures: run, fixture_difficulty: averageDifficulty(run) };
}

/** FPL's own convention: capitals for a home game, lower case away. */
export function opponentLabel(fixture: ClubFixture): string {
  const opponent = fixture.opponent ?? '?';
  return fixture.is_home ? opponent.toUpperCase() : opponent.toLowerCase();
}

/** "GW7–9" for a run, "GW38" for a single gameweek, null for none. */
export function gameweekRangeLabel(gameweeks: readonly number[]): string | null {
  if (gameweeks.length === 0) return null;
  const first = gameweeks[0];
  const last = gameweeks[gameweeks.length - 1];
  return first === last ? `GW${first}` : `GW${first}–${last}`;
}
