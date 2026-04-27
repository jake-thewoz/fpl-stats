/**
 * Hook that builds a StyleSheet for the active theme.
 *
 * The migration pattern looks like:
 *
 *   const makeStyles = (c: Colors) => StyleSheet.create({
 *     row: { backgroundColor: c.surface, borderBottomColor: c.border },
 *   });
 *
 *   function MyComponent() {
 *     const styles = useThemedStyles(makeStyles);
 *     return <View style={styles.row} />;
 *   }
 *
 * `makeStyles` lives at module scope (no per-render allocation of the
 * function). The hook memoizes the resulting StyleSheet on the `Colors`
 * object identity, which is stable per palette — switching modes
 * triggers exactly one re-creation per mounted component.
 *
 * The factory is captured by ref so callers can use a freshly-defined
 * function inline without invalidating the memo on every render. (This
 * matters for ad-hoc styles inside one-off components; the dominant
 * pattern is still module-scope.)
 */
import { useMemo, useRef } from 'react';
import { useTheme } from './ThemeProvider';
import type { Colors } from './colors';

export function useThemedStyles<T>(make: (colors: Colors) => T): T {
  const { colors } = useTheme();
  const makeRef = useRef(make);
  makeRef.current = make;
  return useMemo(() => makeRef.current(colors), [colors]);
}
