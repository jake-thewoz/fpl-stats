import { Pressable, StyleSheet, Text } from 'react-native';
import { useThemedStyles, type Colors } from '../theme';

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
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
      backgroundColor: c.accent,
    },
    label: { color: c.onAccent, fontSize: 13, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
