import { bankDelta, formatBankDelta, formatXpDelta } from './format';

describe('formatXpDelta', () => {
  it('signs gains and losses, with zero reading as a gain', () => {
    expect(formatXpDelta(11.14)).toBe('+11.1');
    expect(formatXpDelta(-0.4)).toBe('−0.4');
    expect(formatXpDelta(0)).toBe('+0.0');
  });
});

describe('bank delta', () => {
  it("flips FPL's cost change into the user's bank change, in millions", () => {
    expect(bankDelta(16)).toBe(-1.6);
    expect(formatBankDelta(16)).toBe('−£1.6m');
    expect(formatBankDelta(-5)).toBe('+£0.5m');
    expect(formatBankDelta(0)).toBe('£0.0m');
  });
});
