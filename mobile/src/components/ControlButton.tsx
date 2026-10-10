import { Pressable, StyleSheet, Text } from 'react-native';
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
  /** Accent fill, e.g. Filter while any filter is applied. */
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
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.background,
    },
    buttonActive: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    text: {
      fontSize: fontSize.sm2,
      color: c.textPrimary,
      fontWeight: '500',
    },
    textActive: { color: c.onAccent },
  });
