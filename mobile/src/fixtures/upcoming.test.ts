import type { ClubFixture, FixturesUpcomingResponse } from '../api/fixturesUpcoming';
import {
  HARDEST_DIFFICULTY,
  averageDifficulty,
  gameweekRangeLabel,
  indexUpcomingFixtures,
  opponentLabel,
  playerFixtureFields,
} from './upcoming';

function fixture(
  opponent: string,
  difficulty: number | null,
  isHome = true,
): ClubFixture {
  return { opponent, is_home: isHome, difficulty, kickoff_time: null };
}

const RESPONSE: FixturesUpcomingResponse = {
  schema_version: 1,
  gameweeks: [7, 8, 9],
  teams: [
    {
      id: 1,
      short_name: 'ARS',
      fixtures: [[fixture('MUN', 4)], [fixture('MCI', 4, false)], []],
    },
    {
      id: 13,
      short_name: 'MCI',
      fixtures: [[fixture('BUR', 1)], [fixture('ARS', 4)], [fixture('FUL', 2)]],
    },
  ],
};

describe('averageDifficulty', () => {
  it('averages every fixture in the run', () => {
    expect(
      averageDifficulty([[fixture('BUR', 1)], [fixture('ARS', 4)], [fixture('FUL', 2)]]),
    ).toBeCloseTo(7 / 3);
  });

  it('counts each fixture of a double gameweek', () => {
    expect(averageDifficulty([[fixture('BUR', 1), fixture('FUL', 3)]])).toBe(2);
  });

  it('counts a blank gameweek as the hardest fixture', () => {
    expect(averageDifficulty([[fixture('BUR', 1)], []])).toBe(
      (1 + HARDEST_DIFFICULTY) / 2,
    );
  });

  it('skips unrated fixtures and is null with nothing to rate', () => {
    expect(averageDifficulty([[fixture('BUR', null)], [fixture('FUL', 2)]])).toBe(2);
    expect(averageDifficulty([])).toBeNull();
  });
});

describe('playerFixtureFields', () => {
  const upcoming = indexUpcomingFixtures(RESPONSE);

  it("joins a player to their club's run", () => {
    const fields = playerFixtureFields(upcoming, 'MCI');
    expect(fields.fixtures).toHaveLength(3);
    expect(fields.fixture_difficulty).toBeCloseTo(7 / 3);
  });

  it('is empty while fixtures load or for an unknown club', () => {
    const empty = { fixtures: null, fixture_difficulty: null };
    expect(playerFixtureFields(undefined, 'MCI')).toEqual(empty);
    expect(playerFixtureFields(upcoming, 'XYZ')).toEqual(empty);
  });

  it('maps club ids to short names', () => {
    expect(upcoming.clubShortNameById.get(13)).toBe('MCI');
  });
});

describe('opponentLabel', () => {
  it('capitalises home games and lower-cases away games', () => {
    expect(opponentLabel(fixture('MUN', 4, true))).toBe('MUN');
    expect(opponentLabel(fixture('MUN', 4, false))).toBe('mun');
  });
});

describe('gameweekRangeLabel', () => {
  it('names the run of gameweeks', () => {
    expect(gameweekRangeLabel([7, 8, 9])).toBe('GW7–9');
    expect(gameweekRangeLabel([38])).toBe('GW38');
    expect(gameweekRangeLabel([])).toBeNull();
  });
});
