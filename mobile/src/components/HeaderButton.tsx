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
  onPress: () => void;
  accessibilityLabel?: string;
};

export function HeaderButton({ label, onPress, accessibilityLabel }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    btn: {
      paddingHorizontal: spacing.base,
      // 5px is a tight one-off vertical inset for header buttons; keeping
      // it inline rather than promoting a near-spacing.xs token.
      paddingVertical: 5,
      borderRadius: radius.sm,
      backgroundColor: c.accent,
    },
    label: { color: c.onAccent, fontSize: fontSize.sm2, fontWeight: '600' },
    pressed: effects.pressedSubtle,
  });
