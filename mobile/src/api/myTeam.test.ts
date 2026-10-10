import type { EntryResponse } from './entry';
import {
  PicksNotFoundError,
  type EntryGameweekResponse,
  type Pick,
} from './entryGameweek';
import type { GameweekLiveResponse } from './gameweekLive';
import {
  assembleMyTeam,
  FREE_HIT_CHIP,
  type MyTeamSources,
  type QuerySnapshot,
} from './myTeam';
import type { Player, PlayersResponse } from './players';

const TEAM_ID = 1234;
const GAMEWEEK = 8;
const CAPTAIN_MULTIPLIER = 2;
const HAALAND_ID = 430;
const BRUNO_ID = 366;
const BENCH_PLAYER_ID = 12;
const BENCH_SLOT = 12;
const HAALAND_POINTS = 9;
const HAALAND_MINUTES = 90;

const pending = <T>(): QuerySnapshot<T> => ({ data: undefined, error: null });
const loaded = <T>(data: T): QuerySnapshot<T> => ({ data, error: null });
const failed = <T>(error: Error): QuerySnapshot<T> => ({ data: undefined, error });

function entryResponse(currentEvent: number | null): EntryResponse {
  return {
    schema_version: 1,
    fetched_at: 0,
    cache: 'hit',
    entry: {
      id: TEAM_ID,
      name: 'Test XI',
      player_first_name: 'Test',
      player_last_name: 'Manager',
      started_event: 1,
      favourite_team: null,
      summary_overall_points: null,
      summary_overall_rank: null,
      summary_event_points: null,
      summary_event_rank: null,
      current_event: currentEvent,
      last_deadline_value: null,
      last_deadline_bank: null,
      last_deadline_total_transfers: null,
    },
  };
}

function player(id: number, name: string): Player {
  return {
    id,
    name,
    team: 'MCI',
    position: 'FWD',
    total_points: 0,
    form: '0.0',
    price: 0,
    defcon: null,
    defcon_per_90: null,
    selected_by_percent: null,
    points_per_game: null,
    minutes: null,
    goals_scored: null,
    assists: null,
    clean_sheets: null,
    bonus: null,
    bps: null,
    ict_index: null,
    expected_goals: null,
    expected_assists: null,
    cost_change_event: null,
  };
}

const PLAYERS: PlayersResponse = {
  schema_version: 1,
  count: 3,
  players: [
    player(HAALAND_ID, 'Haaland'),
    player(BRUNO_ID, 'B.Fernandes'),
    player(BENCH_PLAYER_ID, 'Bench'),
  ],
};

function pick(element: number, position: number, multiplier = 1): Pick {
  return {
    element,
    position,
    multiplier,
    is_captain: multiplier === CAPTAIN_MULTIPLIER,
    is_vice_captain: false,
  };
}

function picksResponse(
  squad: Pick[],
  activeChip: string | null = null,
): EntryGameweekResponse {
  return {
    schema_version: 1,
    fetched_at: 0,
    cache: 'hit',
    entry: {
      team_id: TEAM_ID,
      gameweek: GAMEWEEK,
      points: null,
      total_points: null,
      bank: null,
      value: null,
      event_transfers: null,
      event_transfers_cost: null,
      points_on_bench: null,
      active_chip: activeChip,
      captain: null,
      vice_captain: null,
      squad,
    },
  };
}

const LIVE: GameweekLiveResponse = {
  schema_version: 1,
  gameweek: GAMEWEEK,
  fetched_at: 0,
  cache: 'hit',
  elements: [{ id: HAALAND_ID, total_points: HAALAND_POINTS, minutes: HAALAND_MINUTES }],
};

const SQUAD = [
  pick(HAALAND_ID, 1, CAPTAIN_MULTIPLIER),
  pick(BENCH_PLAYER_ID, BENCH_SLOT),
];

function sources(overrides: Partial<MyTeamSources> = {}): MyTeamSources {
  return {
    entry: loaded(entryResponse(GAMEWEEK)),
    players: loaded(PLAYERS),
    picks: loaded(picksResponse(SQUAD)),
    live: loaded(LIVE),
    previousPicks: pending(),
    ...overrides,
  };
}

describe('assembleMyTeam', () => {
  it('waits for the entry and players', () => {
    expect(assembleMyTeam(sources({ entry: pending() }))).toBeUndefined();
    expect(assembleMyTeam(sources({ players: pending() }))).toBeUndefined();
  });

  it('returns an empty squad before the season has a current gameweek', () => {
    const team = assembleMyTeam(sources({ entry: loaded(entryResponse(null)) }));
    expect(team?.gameweek).toBeNull();
    expect(team?.squad).toEqual([]);
  });

  it('joins picks with players and live points, applying the multiplier', () => {
    const team = assembleMyTeam(sources());
    const [captain, bench] = team?.squad ?? [];
    expect(captain?.player?.name).toBe('Haaland');
    expect(captain?.gwPointsRaw).toBe(HAALAND_POINTS);
    expect(captain?.gwPoints).toBe(HAALAND_POINTS * CAPTAIN_MULTIPLIER);
    expect(captain?.minutes).toBe(HAALAND_MINUTES);
    expect(captain?.isStarter).toBe(true);
    expect(bench?.isStarter).toBe(false);
    expect(bench?.gwPoints).toBeNull();
  });

  it('explains missing picks instead of failing', () => {
    const team = assembleMyTeam(
      sources({ picks: failed(new PicksNotFoundError(String(TEAM_ID), GAMEWEEK)) }),
    );
    expect(team?.squad).toEqual([]);
    expect(team?.picksError).toMatch(/not found/i);
  });

  it('leaves other picks failures to the caller', () => {
    expect(
      assembleMyTeam(sources({ picks: failed(new Error('HTTP 500')) })),
    ).toBeUndefined();
  });

  it('waits for live points, but renders without them if they fail', () => {
    expect(assembleMyTeam(sources({ live: pending() }))).toBeUndefined();
    const team = assembleMyTeam(sources({ live: failed(new Error('HTTP 404')) }));
    expect(team?.squad[0]?.gwPoints).toBeNull();
  });

  describe('with Free Hit active', () => {
    const freeHitPicks = loaded(picksResponse([pick(BRUNO_ID, 1)], FREE_HIT_CHIP));

    it('shows the previous gameweek squad once it arrives', () => {
      expect(assembleMyTeam(sources({ picks: freeHitPicks }))).toBeUndefined();
      const team = assembleMyTeam(
        sources({ picks: freeHitPicks, previousPicks: loaded(picksResponse(SQUAD)) }),
      );
      expect(team?.showingPersistentSquad).toBe(true);
      expect(team?.squad.map((s) => s.pick.element)).toEqual([
        HAALAND_ID,
        BENCH_PLAYER_ID,
      ]);
      expect(team?.picks?.active_chip).toBe(FREE_HIT_CHIP);
    });

    it('falls back to the Free Hit squad if the previous gameweek fails', () => {
      const team = assembleMyTeam(
        sources({ picks: freeHitPicks, previousPicks: failed(new Error('HTTP 404')) }),
      );
      expect(team?.showingPersistentSquad).toBe(false);
      expect(team?.squad.map((s) => s.pick.element)).toEqual([BRUNO_ID]);
    });
  });
});
