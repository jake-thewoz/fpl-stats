/**
 * On web, centers the app in a phone-shaped column on wide viewports and
 * fills the surrounding canvas with the active theme background. The inner
 * column keeps the mobile-first design intact; the outer canvas keeps
 * desktop browsers from showing a stretched-out, broken-looking layout.
 *
 * On native (iOS/Android), returns children unchanged — zero-cost
 * passthrough so this can wrap the root tree without per-callsite
 * platform checks.
 */
import { useEffect, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';

const WEB_COLUMN_MAX_WIDTH = 480;

export function WebShell({ children }: { children: ReactNode }) {
  const { colors } = useTheme();

  // Match the page background to the theme so the surrounding canvas
  // and the area outside our centered column read as one surface, and
  // the body doesn't flash white when the theme switches at runtime.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.body.style.backgroundColor = colors.background;
  }, [colors.background]);

  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }

  return (
    <View style={[styles.canvas, { backgroundColor: colors.background }]}>
      <View style={[styles.column, { backgroundColor: colors.background }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    alignItems: 'center',
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: WEB_COLUMN_MAX_WIDTH,
  },
});
