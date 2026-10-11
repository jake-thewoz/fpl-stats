import type { Entry } from '../../api/entry';
import {
  awardsByTeam,
  gameweekSummary,
  managerInitials,
  shortManagerName,
  spotlights,
  winners,
  type LoadedTeam,
} from './summary';

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: 1,
    name: 'Squad',
    player_first_name: 'Ana',
    player_last_name: 'Ruiz',
    started_event: 1,
    favourite_team: null,
    summary_overall_points: 300,
    summary_overall_rank: 1_000_000,
    summary_event_points: 50,
    summary_event_rank: 1_000_000,
    current_event: 6,
    last_deadline_value: 1000,
    last_deadline_bank: 0,
    last_deadline_total_transfers: 5,
    ...overrides,
  };
}

function team(id: string, overrides: Partial<Entry>, isMe = false): LoadedTeam {
  return { id, isMe, entry: entry(overrides) };
}

const ME = team(
  'me',
  { summary_event_points: 54, player_first_name: 'Gavin', player_last_name: 'Dent' },
  true,
);
const ANA = team('ana', {
  summary_event_points: 71,
  summary_overall_rank: 412_000,
  last_deadline_value: 1021,
  last_deadline_total_transfers: 9,
});
const SAM = team('sam', {
  summary_event_points: 38,
  summary_overall_rank: 640_000,
  last_deadline_value: 1034,
  last_deadline_total_transfers: 14,
  player_first_name: 'Sam',
  player_last_name: 'Okafor',
});
const JO = team('jo', {
  summary_event_points: 29,
  summary_overall_rank: 4_800_000,
  last_deadline_value: 1009,
  last_deadline_total_transfers: 3,
  player_first_name: 'Jo',
  player_last_name: 'Lee',
});
const TEAMS = [ME, ANA, SAM, JO];

describe('names', () => {
  it('shortens a manager to first name and last initial', () => {
    expect(shortManagerName(ANA.entry)).toBe('Ana R.');
    expect(shortManagerName(entry({ player_first_name: '', player_last_name: '' }))).toBe(
      'Squad',
    );
  });

  it('builds initials from first and last names', () => {
    expect(managerInitials(SAM.entry)).toBe('SO');
    expect(
      managerInitials(entry({ player_first_name: 'Pelé', player_last_name: '' })),
    ).toBe('PE');
  });
});

describe('winners', () => {
  it('finds the best value in either direction', () => {
    expect(winners(TEAMS, 'topGameweek')).toEqual([ANA]);
    expect(winners(TEAMS, 'bestRank')).toEqual([ANA]);
    expect(winners(TEAMS, 'fewestTransfers')).toEqual([JO]);
  });

  it('lets ties share an award, unless everyone ties', () => {
    const tied = team('tied', { summary_event_points: 71 });
    expect(winners([...TEAMS, tied], 'topGameweek')).toEqual([ANA, tied]);
    expect(
      winners([ANA, team('copy', { summary_event_points: 71 })], 'topGameweek'),
    ).toEqual([]);
  });

  it('needs two teams with the stat', () => {
    expect(winners([ANA], 'topGameweek')).toEqual([]);
    expect(
      winners([ANA, team('blank', { summary_event_points: null })], 'topGameweek'),
    ).toEqual([]);
  });
});

describe('awardsByTeam', () => {
  it('lists each team’s awards in display order', () => {
    const awards = awardsByTeam(TEAMS);
    expect(awards.get('ana')).toEqual(['topGameweek', 'bestRank']);
    expect(awards.get('sam')).toEqual(['biggestSquad', 'mostTransfers']);
    expect(awards.get('jo')).toEqual(['fewestTransfers']);
    expect(awards.has('me')).toBe(false);
  });
});

describe('gameweekSummary', () => {
  it('compares you with your friends’ average, leaving you out of it', () => {
    const summary = gameweekSummary(TEAMS);
    expect(summary?.myPoints).toBe(54);
    expect(summary?.friendsAverage).toBeCloseTo((71 + 38 + 29) / 3);
    expect(summary?.top.team).toBe(ANA);
    expect(summary?.scores.map((s) => s.points)).toEqual([29, 38, 54, 71]);
  });

  it('works without your team', () => {
    const summary = gameweekSummary([ANA, SAM]);
    expect(summary?.myPoints).toBeNull();
    expect(summary?.friendsAverage).toBeCloseTo((71 + 38) / 2);
  });

  it('is null with nobody to compare against', () => {
    expect(gameweekSummary([ME])).toBeNull();
  });
});

describe('spotlights', () => {
  it('names a winner for each season stat', () => {
    expect(spotlights(TEAMS).map((s) => [s.kind, s.team.id, s.value])).toEqual([
      ['bestRank', 'ana', 412_000],
      ['biggestSquad', 'sam', 103.4],
      ['mostTransfers', 'sam', 14],
    ]);
  });
});
