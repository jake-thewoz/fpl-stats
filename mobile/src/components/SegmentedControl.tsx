import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
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

/** Single-choice toggle (e.g. Pitch | List): a raised track with the
 *  selected segment filled in the accent. Segments share any width the
 *  parent gives the track. */
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
    // Inner radius = track radius − track padding, so the selected fill
    // sits concentric with the track.
    track: {
      flexDirection: 'row',
      borderRadius: radius.base,
      padding: spacing.hairline,
      backgroundColor: c.surfaceRaised,
    },
    segment: {
      flexGrow: 1,
      alignItems: 'center',
      paddingHorizontal: spacing.lg2,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
    },
    segmentSelected: { backgroundColor: c.accent },
    label: { fontSize: fontSize.sm2, color: c.textMuted, fontWeight: '600' },
    labelSelected: { color: c.onAccent },
  });
