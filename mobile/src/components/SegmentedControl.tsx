import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  effects,
  fontSize,
  radius,
  spacing,
  useThemedStyles,
  type Colors,
} from '../theme';

export type SegmentOption<T extends string | number> = { value: T; label: string };

type Props<T extends string | number> = {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
};

/** Pill-shaped single-choice toggle (e.g. List | Pitch). */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
}: Props<T>) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.segmentSelected,
              pressed && effects.pressedSubtle,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    track: {
      flexDirection: 'row',
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.background,
      overflow: 'hidden',
    },
    segment: {
      paddingHorizontal: spacing.lg2,
      paddingVertical: spacing.sm,
    },
    segmentSelected: { backgroundColor: c.accent },
    label: { fontSize: fontSize.sm2, color: c.textPrimary, fontWeight: '500' },
    labelSelected: { color: c.onAccent },
  });
