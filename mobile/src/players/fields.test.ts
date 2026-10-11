import { HEAT_CEILING } from '../theme/heat';
import { gameweeksPlayedBefore, heatCeiling } from './fields';

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
  });
});

describe('gameweeksPlayedBefore', () => {
  it('counts the gameweeks before the one xP projects', () => {
    expect(gameweeksPlayedBefore(8)).toBe(7);
    expect(gameweeksPlayedBefore(null)).toBeNull();
  });
});
