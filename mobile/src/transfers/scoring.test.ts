import { darkColors, lightColors } from '../theme/colors';
import { fixtureDifficultyColor } from './scoring';

describe('fixtureDifficultyColor', () => {
  it.each([lightColors, darkColors])(
    'runs mint to coral through a neutral 3',
    (colors) => {
      expect(fixtureDifficultyColor(1, colors)).toEqual({
        background: colors.good,
        text: colors.onGood,
      });
      expect(fixtureDifficultyColor(3, colors).background).toBe(colors.surfaceRaised);
      expect(fixtureDifficultyColor(5, colors)).toEqual({
        background: colors.bad,
        text: colors.onBad,
      });
    },
  );

  it('tints 2 and 4 without reaching the full fills', () => {
    const easy = fixtureDifficultyColor(2, lightColors).background;
    const hard = fixtureDifficultyColor(4, lightColors).background;
    expect([lightColors.good, lightColors.surfaceRaised]).not.toContain(easy);
    expect([lightColors.bad, lightColors.surfaceRaised]).not.toContain(hard);
  });

  it('renders an unrated fixture neutral', () => {
    expect(fixtureDifficultyColor(null, darkColors).background).toBe(
      darkColors.surfaceRaised,
    );
  });
});
