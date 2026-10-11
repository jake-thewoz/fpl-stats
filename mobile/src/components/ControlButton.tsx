import { Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';
import {
  effects,
  fontSize,
  radius,
  spacing,
  useThemedStyles,
  type Colors,
} from '../theme';

type Props = {
  label: string;
  /** Soft accent fill, e.g. Filter while any filter is applied. */
  active?: boolean;
  onPress: () => void;
};

/** Pill button for list control bars (Filter / Columns). */
export function ControlButton({ label, active, onPress }: Props) {
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        active && styles.buttonActive,
        pressed && effects.pressedSubtle,
      ]}
      accessibilityRole="button"
    >
      <Text style={[styles.text, active && styles.textActive]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    button: {
      paddingHorizontal: spacing.lg2,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
      backgroundColor: c.surfaceRaised,
    },
    buttonActive: { backgroundColor: c.accentSoft },
    text: {
      fontSize: fontSize.sm2,
      color: c.textPrimary,
      fontWeight: '600',
    },
    textActive: { color: c.accentText },
  });
