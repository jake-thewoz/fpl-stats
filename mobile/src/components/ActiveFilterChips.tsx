import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { activeFilterChips } from '../players/apply';
import { EMPTY_FILTER, type FilterState } from '../players/types';
import {
  effects,
  fontSize,
  radius,
  spacing,
  useThemedStyles,
  type Colors,
} from '../theme';

// Long position/team lists ellipsize at this width rather than stretching
// a single chip across the whole strip.
const CHIP_LABEL_MAX_WIDTH = 180;
// The ✕ glyph is small; widen its touch target without growing the chip.
const REMOVE_HIT_SLOP = spacing.md;
// Below this many chips a dedicated clear-all is redundant with the chip's ✕.
const CLEAR_ALL_MIN_CHIPS = 2;

type Props = {
  filters: FilterState;
  onChange: (next: FilterState) => void;
};

/**
 * Horizontal strip of the applied filters, one chip per constraint, each
 * removable in place (#103). Renders nothing when no filter is active.
 */
export function ActiveFilterChips({ filters, onChange }: Props) {
  const styles = useThemedStyles(makeStyles);
  const chips = activeFilterChips(filters);
  if (chips.length === 0) return null;

  return (
    <View style={styles.strip}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollBody}
      >
        {chips.map((chip) => (
          <View key={chip.id} style={styles.chip}>
            <Text style={styles.chipLabel} numberOfLines={1}>
              {chip.label}
            </Text>
            <Pressable
              onPress={() => onChange(chip.remove(filters))}
              hitSlop={REMOVE_HIT_SLOP}
              style={({ pressed }) => pressed && effects.pressedSubtle}
              accessibilityRole="button"
              accessibilityLabel={`Remove filter ${chip.label}`}
            >
              <Text style={styles.chipRemove}>✕</Text>
            </Pressable>
          </View>
        ))}
        {chips.length >= CLEAR_ALL_MIN_CHIPS ? (
          <Pressable
            onPress={() => onChange(EMPTY_FILTER)}
            style={({ pressed }) => pressed && effects.pressedSubtle}
            accessibilityRole="button"
          >
            <Text style={styles.clearAll}>Clear all</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    strip: {
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    scrollBody: {
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.xs,
      borderRadius: radius.lg,
      backgroundColor: c.accentSoft,
    },
    chipLabel: {
      maxWidth: CHIP_LABEL_MAX_WIDTH,
      fontSize: fontSize.sm,
      fontWeight: '500',
      color: c.onAccentSoft,
    },
    chipRemove: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      color: c.onAccentSoft,
    },
    clearAll: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: c.accent,
    },
  });
