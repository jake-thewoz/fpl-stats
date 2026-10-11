import { useMemo, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { Text } from '../../components/Text';
import { fontRole, fontSize, spacing, useTheme } from '../../theme';

/**
 * Header options shared by every tab's stack.
 *
 * `stack` goes on the navigator: pushed screens (Friend Team, Gameweek,
 * Manage Friends) get an ordinary back-button header on the page
 * background. `tabRoot(title)` goes on each tab's first screen and swaps
 * the centred title for a large display-font title on the left.
 *
 * The large title is drawn in `headerLeft` rather than through
 * `headerTitleAlign: 'left'`, which iOS ignores, and through the app's
 * `Text` so the display role resolves to Sora.
 */

// Native headers already inset their content 16px from each edge; the
// JS header used on web puts `headerLeft` / `headerRight` flush against
// the screen edge. Padding them on web lines the title and header buttons
// up with the screen's 16px content gutter.
export const HEADER_EDGE_INSET = Platform.OS === 'web' ? spacing.xl : 0;

export function useStackHeaderOptions() {
  const { colors } = useTheme();
  return useMemo(() => {
    const stack: NativeStackNavigationOptions = {
      headerStyle: { backgroundColor: colors.background },
      headerShadowVisible: false,
      headerTintColor: colors.accentText,
      headerTitleStyle: { color: colors.textPrimary },
    };
    const tabRoot = (
      title: string,
      headerRight?: () => ReactNode,
    ): NativeStackNavigationOptions => ({
      title,
      headerRight:
        headerRight && (() => <View style={styles.right}>{headerRight()}</View>),
      headerTitle: () => null,
      headerLeft: () => (
        <Text
          style={[styles.title, { color: colors.textPrimary }]}
          accessibilityRole="header"
        >
          {title}
        </Text>
      ),
    });
    return { stack, tabRoot };
  }, [colors]);
}

const styles = StyleSheet.create({
  title: {
    ...fontRole.display,
    fontSize: fontSize.screenTitle,
    paddingStart: HEADER_EDGE_INSET,
  },
  right: { paddingEnd: HEADER_EDGE_INSET },
});
