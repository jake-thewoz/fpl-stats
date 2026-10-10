import {
  DEFAULT_MAX_TRANSFERS,
  DEFAULT_TRANSFER_SETTINGS,
  FREE_TRANSFER_OPTIONS,
  MAX_TRANSFER_OPTIONS,
  countActiveFilters,
  freeTransfersOverrideFor,
  pluralize,
} from './settings';

describe('option lists', () => {
  it('offers bundle sizes 1 to 3', () => {
    expect(MAX_TRANSFER_OPTIONS).toEqual([1, 2, 3]);
  });

  it('offers free transfers 0 to the banked cap of 5', () => {
    expect(FREE_TRANSFER_OPTIONS).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('includes the default bundle size', () => {
    expect(MAX_TRANSFER_OPTIONS).toContain(DEFAULT_MAX_TRANSFERS);
  });
});

describe('freeTransfersOverrideFor', () => {
  it('clears the override when the derived value is picked', () => {
    expect(freeTransfersOverrideFor(1, 1)).toBeNull();
  });

  it('keeps a value that differs from the derived count', () => {
    expect(freeTransfersOverrideFor(0, 1)).toBe(0);
  });

  it('keeps the value when the derived count is unknown', () => {
    expect(freeTransfersOverrideFor(2, undefined)).toBe(2);
  });
});

describe('countActiveFilters', () => {
  it('is zero for defaults', () => {
    expect(countActiveFilters([], DEFAULT_TRANSFER_SETTINGS)).toBe(0);
  });

  it('counts each position plus each non-default setting', () => {
    expect(
      countActiveFilters([2, 3], { maxTransfers: 3, freeTransfersOverride: 0 }),
    ).toBe(4);
  });
});

describe('pluralize', () => {
  it('uses the singular for one', () => {
    expect(pluralize(1, 'move', 'moves')).toBe('1 move');
  });

  it('uses the plural otherwise', () => {
    expect(pluralize(0, 'move', 'moves')).toBe('0 moves');
  });
});
