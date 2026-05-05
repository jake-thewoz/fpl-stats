import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  fontSize,
  spacing,
  useThemedStyles,
  type Colors,
} from '../../theme';

type Props = {
  /** Uppercase muted heading. Optional — ColumnPicker has hint-only
   *  sections, FilterDialog has title-only sections. */
  title?: string;
  /** Smaller paragraph shown below the title. */
  hint?: string;
  children: ReactNode;
};

/**
 * Standard dialog section: optional uppercase title, optional hint
 * paragraph, then a body block with hairline borders top + bottom.
 *
 * Body content is rendered as-is into a `View`. Custom layouts
 * (e.g. FilterDialog's range row with horizontal flex) are applied
 * by the caller on a wrapper inside `children`.
 */
export function Section({ title, hint, children }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={[styles.title, hint && styles.titleWithHint]}>
          {title}
        </Text>
      ) : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    section: { marginTop: spacing.xxl },
    title: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.md,
      color: c.textMuted,
      fontSize: fontSize.sm2,
      fontWeight: '600',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    // When a hint follows the title, tighten the title's bottom padding
    // so the title and hint read as a unit instead of drifting apart.
    titleWithHint: { paddingBottom: spacing.xs },
    hint: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.md,
      color: c.textMuted,
      fontSize: fontSize.sm,
      lineHeight: 16,
    },
    body: {
      backgroundColor: c.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
  });
