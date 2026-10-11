import { PLAYER_STAT_KEYS } from '../api/playerStats';
import { HEAT_CEILING } from '../theme/heat';
import {
  FIELD_DEFS,
  FIELD_GROUPS,
  FIELDS_IN_PICKER_ORDER,
  gameweeksPlayedBefore,
  heatCeiling,
} from './fields';
import type { FieldKey, JoinedPlayer } from './types';

describe('heatCeiling', () => {
  it('uses the shared xP ceiling for next-gameweek xP', () => {
    expect(heatCeiling('xp', null)).toBe(HEAT_CEILING.expectedPoints);
  });

  it('scales a season total by gameweeks played', () => {
    const afterOne = heatCeiling('total_points', 1);
    expect(afterOne).not.toBeNull();
    expect(heatCeiling('total_points', 10)).toBe((afterOne ?? 0) * 10);
  });

  it('leaves season totals plain before the first gameweek or when unknown', () => {
    expect(heatCeiling('total_points', 0)).toBeNull();
    expect(heatCeiling('total_points', null)).toBeNull();
  });

  it('never heat-colours columns where bigger is not better', () => {
    expect(heatCeiling('price', 10)).toBeNull();
    expect(heatCeiling('selected_by_percent', 10)).toBeNull();
    expect(heatCeiling('cost_change_event', 10)).toBeNull();
    expect(heatCeiling('transfers_in', 10)).toBeNull();
  });

  it('never heat-colours columns where less is better', () => {
    const lessIsBetter: FieldKey[] = [
      'goals_conceded',
      'expected_goals_conceded',
      'yellow_cards',
      'red_cards',
      'own_goals',
      'penalties_missed',
    ];
    for (const key of lessIsBetter) expect(heatCeiling(key, 10)).toBeNull();
  });
});

describe('FIELD_GROUPS', () => {
  it('puts every field in exactly one group', () => {
    const grouped = FIELDS_IN_PICKER_ORDER.map((f) => f.key);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(Object.keys(FIELD_DEFS).sort());
  });

  it('has no empty groups', () => {
    for (const group of FIELD_GROUPS) expect(group.fields.length).toBeGreaterThan(0);
  });
});

describe('stat fields', () => {
  const row = (stats: JoinedPlayer['stats']) => ({ stats }) as JoinedPlayer;

  it('read their value from the joined stats', () => {
    expect(FIELD_DEFS.saves.accessor(row({ saves: 31 }))).toBe(31);
  });

  it('are blank while stats are loading or missing', () => {
    expect(FIELD_DEFS.saves.accessor(row(null))).toBeNull();
    expect(FIELD_DEFS.saves.accessor(row({}))).toBeNull();
  });

  it('exist for every key /players/stats serves', () => {
    for (const key of PLAYER_STAT_KEYS) expect(FIELD_DEFS[key].key).toBe(key);
  });

  it('sort ascending by default where less is better', () => {
    expect(FIELD_DEFS.goals_conceded.defaultSortDir).toBe('asc');
    expect(FIELD_DEFS.saves.defaultSortDir).toBe('desc');
  });

  it('show per-90 rates to two decimals', () => {
    expect(FIELD_DEFS.expected_goals_per_90.format(0.456)).toBe('0.46');
  });
});

describe('gameweeksPlayedBefore', () => {
  it('counts the gameweeks before the one xP projects', () => {
    expect(gameweeksPlayedBefore(8)).toBe(7);
    expect(gameweeksPlayedBefore(null)).toBeNull();
  });
});
