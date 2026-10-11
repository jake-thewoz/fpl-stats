import { requestJson } from './http';

export type ClubFixture = {
  /** Opponent's short name, e.g. 'ARS'. Null if FPL drops the club. */
  opponent: string | null;
  is_home: boolean;
  /** FPL's fixture difficulty rating from this club's side, 1 (easy) to
   *  5 (hard). Null when FPL hasn't rated the fixture. */
  difficulty: number | null;
  kickoff_time: string | null;
};

export type ClubUpcomingFixtures = {
  id: number;
  short_name: string;
  /** One list per entry in `gameweeks`: empty for a blank gameweek, two
   *  fixtures for a double. */
  fixtures: ClubFixture[][];
};

export type FixturesUpcomingResponse = {
  schema_version: number;
  /** The next gameweeks whose deadline is still ahead, ascending. */
  gameweeks: number[];
  teams: ClubUpcomingFixtures[];
};

export async function fetchFixturesUpcoming(
  signal?: AbortSignal,
): Promise<FixturesUpcomingResponse> {
  return requestJson<FixturesUpcomingResponse>('/fixtures/upcoming', { signal });
}
