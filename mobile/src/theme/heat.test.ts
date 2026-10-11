import { darkColors, lightColors } from './colors';
import { HEAT_CEILING, heatColor, mixHex } from './heat';

describe('mixHex', () => {
  it('returns the endpoints at 0 and 1', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('blends each channel linearly', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#ff0000', '#0000ff', 0.25)).toBe('#bf0040');
  });

  it('rejects colours it cannot blend', () => {
    expect(() => mixHex('rgba(0, 0, 0, 0.5)', '#ffffff', 0.5)).toThrow();
  });
});

describe('heatColor', () => {
  const ceiling = HEAT_CEILING.playerPoints;

  it.each([
    ['dark', darkColors],
    ['light', lightColors],
  ])('spans surfaceRaised to good in %s mode', (_mode, colors) => {
    expect(heatColor(0, ceiling, colors).background).toBe(colors.surfaceRaised);
    expect(heatColor(ceiling, ceiling, colors).background).toBe(colors.good);
  });

  it('clamps values outside zero to the ceiling', () => {
    expect(heatColor(-3, ceiling, darkColors)).toEqual(heatColor(0, ceiling, darkColors));
    expect(heatColor(ceiling * 2, ceiling, darkColors)).toEqual(
      heatColor(ceiling, ceiling, darkColors),
    );
  });

  it('flips the text to onGood only past the midpoint', () => {
    expect(heatColor(ceiling / 2, ceiling, darkColors).text).toBe(darkColors.textPrimary);
    expect(heatColor(ceiling / 2 + 1, ceiling, darkColors).text).toBe(darkColors.onGood);
  });
});
