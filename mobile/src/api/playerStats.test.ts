import { indexPlayerStats, type PlayerStatsResponse } from './playerStats';

const HAALAND_ID = 430;
const BRUNO_ID = 366;

const RESPONSE: PlayerStatsResponse = {
  schema_version: 1,
  fetched_at: '2026-10-11T06:00:00+00:00',
  count: 2,
  ids: [HAALAND_ID, BRUNO_ID],
  stats: {
    starts: [6, 6],
    expected_goals_per_90: [0.91, null],
  },
};

describe('indexPlayerStats', () => {
  it('lines each column up with the ids', () => {
    const byId = indexPlayerStats(RESPONSE);
    expect(byId.get(HAALAND_ID)).toEqual({ starts: 6, expected_goals_per_90: 0.91 });
    expect(byId.get(BRUNO_ID)).toEqual({ starts: 6, expected_goals_per_90: null });
  });

  it('leaves out stats the response lacks', () => {
    expect(indexPlayerStats(RESPONSE).get(HAALAND_ID)).not.toHaveProperty('saves');
  });
});
