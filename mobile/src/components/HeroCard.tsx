import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme';

// The gradient runs corner to corner, top-left to bottom-right.
const HERO_GRADIENT_START = { x: 0, y: 0 };
const HERO_GRADIENT_END = { x: 1, y: 1 };

/** Labels and units on a hero card sit a step back from the white numbers. */
export const HERO_SECONDARY_OPACITY = 0.8;

/** The grape gradient card behind a screen's headline numbers. Text on
 *  it uses `colors.onHero`. */
export function HeroCard({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <LinearGradient
      colors={colors.heroGradient}
      start={HERO_GRADIENT_START}
      end={HERO_GRADIENT_END}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}
