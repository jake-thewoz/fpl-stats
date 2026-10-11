import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Text } from '../Text';
import type { FieldGroup, FieldGroupKey } from '../../players/fields';
import {
  effects,
  fontSize,
  radius,
  spacing,
  useThemedStyles,
  type Colors,
} from '../../theme';

type Props = {
  groups: readonly FieldGroup[];
  active: FieldGroupKey;
  onChange: (group: FieldGroupKey) => void;
  /** How many of a group's fields are in use (picked columns, set
   *  ranges), shown on its tab so nothing hides on an unopened one. */
  countFor: (group: FieldGroup) => number;
};

/**
 * A row of tabs over the stat groups, scrolling sideways when they don't
 * fit. Sits above the dialog's scrolling body, so it stays in view.
 */
export function FieldGroupTabs({ groups, active, onChange, countFor }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.strip}
      contentContainerStyle={styles.stripContent}
      accessibilityRole="tablist"
    >
      {groups.map((group) => {
        const selected = group.key === active;
        const count = countFor(group);
        return (
          <Pressable
            key={group.key}
            onPress={() => onChange(group.key)}
            style={({ pressed }) => [
              styles.tab,
              selected && styles.tabSelected,
              pressed && !selected && effects.pressedSubtle,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {count > 0 ? `${group.label} · ${count}` : group.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    // Without flexShrink 0 the dialog's scrolling body squeezes the strip
    // to nothing on web.
    strip: {
      flexGrow: 0,
      flexShrink: 0,
      backgroundColor: c.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    stripContent: {
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
    },
    tab: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
      backgroundColor: c.surfaceRaised,
    },
    tabSelected: { backgroundColor: c.accent },
    label: { fontSize: fontSize.sm2, color: c.textMuted, fontWeight: '700' },
    labelSelected: { color: c.onAccent },
  });
